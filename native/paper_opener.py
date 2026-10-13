#!/usr/bin/env python3
"""Helper for the Papurr extension (Chrome "native messaging" host).

The extension asks this program to open a PDF from the papers folder in an external PDF app.
The papers folder is found automatically: the extension puts a marker file (.paper-folder-id)
with a random token into it, and this program searches the home directory for that token once
(the result is cached). Only PDF files directly inside that folder can be opened.
Works on macOS, Linux and Windows; the AI part (ai_runner) is not offered on Windows.
"""
import glob
import json
import os
import plistlib
import shlex
import shutil
import struct
import subprocess
import sys
import threading
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ai_runner  # the AI part (asks the user's own `claude` command)

IS_MAC = sys.platform == "darwin"
IS_WIN = sys.platform == "win32"
MAC_APP_DIRS = ["/Applications", "~/Applications", "/System/Applications", "/System/Applications/Utilities", "/Applications/Utilities"]

MARKER = ".paper-folder-id"
CACHE = (os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "paper-folder-manager", "folders.json") if IS_WIN
         else os.path.expanduser("~/.cache/paper-folder-manager/folders.json"))
SKIP_DIRS = {"node_modules", "__pycache__", "snap", "site-packages"}
WIN_APP_ROOTS = ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "LOCALAPPDATA"]  # where Windows programs live (environment variables)


def binary_stdio():
    """Chrome talks to the helper in binary messages; Windows would otherwise translate line endings."""
    if IS_WIN:
        import msvcrt
        for stream in (sys.stdin, sys.stdout):
            msvcrt.setmode(stream.fileno(), os.O_BINARY)


def spawn(command):
    """Start a program that keeps running on its own (the PDF app, the file manager)."""
    if IS_WIN:
        flags = getattr(subprocess, "DETACHED_PROCESS", 0x8) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x200)
        return subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags, close_fds=True)
    return subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
MAX_DEPTH = 8


def read_message():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    length = struct.unpack("=I", raw)[0]
    return json.loads(sys.stdin.buffer.read(length).decode("utf-8"))


def send_message(obj):
    data = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(data)) + data)
    sys.stdout.buffer.flush()


def has_marker(folder, token):
    try:
        with open(os.path.join(folder, MARKER), encoding="utf-8") as f:
            return f.read().strip() == token
    except OSError:
        return False


def load_cache():
    try:
        with open(CACHE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def search_roots():
    """Where to look for the papers folder, most likely places first, then the rest of the home directory."""
    home = os.path.expanduser("~")
    roots = [os.path.join(home, d) for d in ("Documents", "Desktop", "Downloads", "Dropbox", "Google Drive", "OneDrive")]
    if IS_MAC:
        # Cloud services (Dropbox, Google Drive, OneDrive, ...) and iCloud Drive keep their folders here.
        roots += [os.path.join(home, "Library", "CloudStorage"), os.path.join(home, "Library", "Mobile Documents")]
    if IS_WIN:
        # OneDrive of a work or school account ("OneDrive - Name"), iCloud Drive, and Google Drive's own drive letter.
        roots += sorted(glob.glob(os.path.join(home, "OneDrive - *"))) + [os.path.join(home, "iCloudDrive")]
        roots += [letter + ":\\My Drive" for letter in "DEFGHIJKLMNOPQRSTUVWXYZ"]
    return [r for r in roots if os.path.isdir(r)] + [home]


def walk_for_marker(root, token, home_skip_library):
    home = os.path.expanduser("~")
    for current, dirs, files in os.walk(root):
        depth = current[len(root):].count(os.sep)
        skip = set(SKIP_DIRS)
        if home_skip_library and current == home:
            skip.update(("Library", "AppData"))  # huge and uninteresting (macOS / Windows); the useful parts are searched as roots
        dirs[:] = [d for d in dirs if not d.startswith(".") and d not in skip] if depth < MAX_DEPTH else []
        if MARKER in files and has_marker(current, token):
            return current
    return None


def find_folder(token):
    """Return the papers folder whose marker file contains this token, or None."""
    cache = load_cache()
    if token in cache and has_marker(cache[token], token):
        return cache[token]
    home = os.path.expanduser("~")
    for root in search_roots():
        found = walk_for_marker(root, token, home_skip_library=(root == home and (IS_MAC or IS_WIN)))
        if found:
            cache[token] = found
            os.makedirs(os.path.dirname(CACHE), exist_ok=True)
            with open(CACHE, "w", encoding="utf-8") as f:
                json.dump(cache, f)
            return found
    return None


def find_mac_app(name):
    """The path of an application bundle such as "Skim" or "Skim.app" in the usual places, or None."""
    bundle = name if name.lower().endswith(".app") else name + ".app"
    if os.path.isabs(os.path.expanduser(bundle)):
        return os.path.expanduser(bundle) if os.path.isdir(os.path.expanduser(bundle)) else None
    for folder in MAC_APP_DIRS:
        candidate = os.path.join(os.path.expanduser(folder), bundle)
        if os.path.isdir(candidate):
            return candidate
    return None


def find_win_app(name):
    """The .exe of a Windows program: a full path, a program on PATH, or "SumatraPDF" found in the usual install folders."""
    name = name.strip().strip('"')
    if os.path.isfile(name):
        return name
    exe = name if name.lower().endswith(".exe") else name + ".exe"
    if shutil.which(exe):
        return shutil.which(exe)
    if os.path.dirname(name):
        return None  # a path that does not exist
    for var in WIN_APP_ROOTS:
        base = os.environ.get(var)
        for pattern in ("*", os.path.join("*", "*"), os.path.join("Programs", "*")):
            for found in glob.glob(os.path.join(base, pattern, exe)) if base else []:
                return found
    return None


def viewer_command(viewer):
    """The command words for the viewer; an empty setting means the system's default PDF app."""
    viewer = os.path.expanduser(viewer.strip())
    if IS_WIN:
        if not viewer:
            return []  # the default app: os.startfile
        app = find_win_app(viewer)
        if not app:
            raise RuntimeError("PDF app not found: " + viewer)
        return [app]
    if IS_MAC:
        if not viewer:
            return ["open"]  # the default app for PDF files
        words = shlex.split(viewer)
        if len(words) == 1 and shutil.which(words[0]):
            return words  # a command-line program, e.g. /usr/local/bin/skimpdf
        app = find_mac_app(viewer)  # an application such as "Skim" or "/Applications/Skim.app"
        if not app:
            raise RuntimeError("PDF app not found: " + viewer)
        return ["open", "-a", app]
    words = shlex.split(viewer) if viewer else ["xdg-open"]
    if not shutil.which(words[0]):
        raise RuntimeError("PDF app not found: " + words[0])
    return words


def reveal_command(path):
    """The command that shows a file in the system's file manager (Finder on a Mac, File Explorer on Windows)."""
    if IS_WIN:
        return 'explorer /select,"%s"' % path  # (one string: Explorer needs exactly this quoting)
    if IS_MAC:
        return ["open", "-R", path]  # selects the file in a Finder window
    if shutil.which("dbus-send"):  # most Linux file managers: show the folder with the file selected
        return ["dbus-send", "--session", "--print-reply", "--dest=org.freedesktop.FileManager1", "--type=method_call",
                "/org/freedesktop/FileManager1", "org.freedesktop.FileManager1.ShowItems",
                "array:string:file://" + urllib.parse.quote(path), "string:"]
    return ["xdg-open", os.path.dirname(path)]


def reveal(path):
    command = reveal_command(path)
    if IS_WIN:
        spawn(command)
        return
    if not IS_MAC and command[0] == "dbus-send":
        try:
            done = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
            if done.returncode == 0:
                return
        except (OSError, subprocess.TimeoutExpired):
            pass
        command = ["xdg-open", os.path.dirname(path)]  # no file manager answered: at least open the folder
    if not shutil.which(command[0]):
        raise RuntimeError("No file manager found (" + command[0] + ")")
    spawn(command)


def papers_file(message, extensions=(".pdf",)):
    """The full path of the file named in the message (a PDF, or one of `extensions`; directly in the papers folder)."""
    name = message.get("file", "")
    if os.path.basename(name) != name or not name.lower().endswith(extensions) or name.startswith("."):
        raise RuntimeError("Refusing to open: not a %s file name" % " or ".join(e[1:].upper() for e in extensions))
    folder = find_folder(message.get("token", ""))
    if not folder:
        raise RuntimeError("Could not find the papers folder (searched your home directory)")
    path = os.path.join(folder, name)
    if not os.path.isfile(path):
        raise RuntimeError("File not found: " + path)
    return path


# ---- Which app will open the PDFs (shown in Settings) ----
LAUNCH_SERVICES = "~/Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist"
DESKTOP_DIRS = ["~/.local/share/applications", "/usr/local/share/applications", "/usr/share/applications",
                "~/.local/share/flatpak/exports/share/applications", "/var/lib/flatpak/exports/share/applications"]


def mac_default_pdf_bundle(plist_path=LAUNCH_SERVICES):
    """The bundle id of the app the user chose for PDF files, or Preview's when none was chosen."""
    try:
        with open(os.path.expanduser(plist_path), "rb") as f:
            for h in plistlib.load(f).get("LSHandlers", []):
                if h.get("LSHandlerContentType") == "com.adobe.pdf":
                    return h.get("LSHandlerRoleAll") or h.get("LSHandlerRoleViewer") or "com.apple.preview"
    except (OSError, ValueError, plistlib.InvalidFileException):
        pass
    return "com.apple.preview"


def mac_app_for_bundle(bundle, finder=None):
    """{name, path} of the app with this bundle id (asks Spotlight)."""
    def spotlight(b):
        try:
            out = subprocess.run(["mdfind", "kMDItemCFBundleIdentifier == '%s'c" % b.replace("'", "")], capture_output=True, text=True, timeout=10).stdout
            return [p for p in out.splitlines() if p.endswith(".app")]
        except (OSError, subprocess.TimeoutExpired):
            return []
    paths = (finder or spotlight)(bundle)
    if paths:
        return {"name": os.path.basename(paths[0])[:-4], "path": paths[0]}
    return {"name": "Preview" if bundle.lower() == "com.apple.preview" else bundle, "path": ""}


def desktop_name(desktop_id, dirs=None):
    """The visible name of a Linux .desktop entry ("org.gnome.Evince.desktop" -> "Document Viewer")."""
    for d in dirs or DESKTOP_DIRS:
        path = os.path.join(os.path.expanduser(d), desktop_id)
        try:
            with open(path, encoding="utf-8") as f:
                for line in f:
                    if line.startswith("Name="):
                        return line[5:].strip()
        except OSError:
            continue
    return desktop_id[:-8] if desktop_id.endswith(".desktop") else desktop_id


def win_default_pdf_app(query=None):
    """{name, path} of the app Windows opens PDF files with (asks the shell's file associations)."""
    def assoc(what):  # ASSOCSTR_EXECUTABLE = 2, ASSOCSTR_FRIENDLYAPPNAME = 4
        import ctypes
        from ctypes import wintypes
        size = wintypes.DWORD(1024)
        buf = ctypes.create_unicode_buffer(size.value)
        result = ctypes.windll.shlwapi.AssocQueryStringW(0, what, ".pdf", "open", buf, ctypes.byref(size))
        return buf.value if result == 0 else ""
    query = query or assoc
    try:
        path, name = query(2), query(4)
    except Exception:
        return {"name": "", "path": ""}
    return {"name": name or (os.path.basename(path)[:-4] if path.lower().endswith(".exe") else os.path.basename(path)), "path": path}


def describe_viewer(viewer):
    """{name, path} of the app that will open the PDFs with this setting (empty = the system's default)."""
    viewer = os.path.expanduser(viewer.strip())
    if IS_WIN:
        if not viewer:
            return win_default_pdf_app()
        app = find_win_app(viewer) or ""
        return {"name": os.path.basename(app)[:-4] if app.lower().endswith(".exe") else (os.path.basename(app) or viewer), "path": app}
    if IS_MAC:
        if not viewer:
            return mac_app_for_bundle(mac_default_pdf_bundle())
        words = shlex.split(viewer)
        if len(words) == 1 and shutil.which(words[0]):
            return {"name": os.path.basename(words[0]), "path": shutil.which(words[0])}
        app = find_mac_app(viewer)
        return {"name": os.path.basename(app)[:-4], "path": app} if app else {"name": viewer, "path": ""}
    if not viewer:
        try:
            desktop = subprocess.run(["xdg-mime", "query", "default", "application/pdf"], capture_output=True, text=True, timeout=10).stdout.strip()
        except (OSError, subprocess.TimeoutExpired):
            desktop = ""
        return {"name": desktop_name(desktop), "path": ""} if desktop else {"name": "", "path": ""}
    words = shlex.split(viewer)
    return {"name": os.path.basename(words[0]), "path": shutil.which(words[0]) or ""}


def handle(message):
    action = message.get("action")
    if action == "ping":
        viewer_command(message.get("viewer", ""))  # raises if the app is missing
        return {"ok": True, "app": describe_viewer(message.get("viewer", ""))}
    if action == "locate":  # the full path of the papers folder (shown in Settings)
        folder = find_folder(message.get("token", ""))
        if not folder:
            raise RuntimeError("Could not find the papers folder (searched your home directory)")
        return {"ok": True, "path": folder}
    if action == "open":
        command, path = viewer_command(message.get("viewer", "")), papers_file(message)
        if command:
            spawn(command + [path])
        else:
            os.startfile(path)  # Windows: the default PDF app
        return {"ok": True}
    if action == "reveal":
        reveal(papers_file(message, (".pdf", ".md")))
        return {"ok": True}
    if action == "edit":  # a paper's note (Markdown) in the user's usual text editor
        path = papers_file(message, (".md",))
        if IS_WIN:
            try:
                os.startfile(path)
            except OSError:  # no app is registered for .md files
                spawn(["notepad.exe", path])
        elif IS_MAC:
            spawn(["open", "-t", path])  # the default text editor
        elif shutil.which("xdg-open"):
            spawn(["xdg-open", path])
        else:
            raise RuntimeError("No program found to open the note (xdg-open)")
        return {"ok": True}
    if action == "ai_status":  # uses no quota
        if IS_WIN:
            raise RuntimeError("AI features are not available on Windows")
        return ai_runner.status(message, IS_MAC)
    raise RuntimeError("Unknown request")


def serve_ai_run(message):
    """Run one AI question in a worker thread while this thread watches the pipe from Chrome: when the extension closes
    the connection (the user pressed Cancel, or the page was closed) the command is stopped and its temporary directory removed."""
    holder = {}

    def worker():
        try:
            reply = ai_runner.execute(message, holder)
        except Exception as e:  # report every problem back to the extension
            reply = {"ok": False, "code": "error", "error": str(e)}
        send_message(reply)
        os._exit(0)

    threading.Thread(target=worker, daemon=True).start()
    try:
        sys.stdin.buffer.read()  # returns when Chrome closes the pipe
    except Exception:
        pass
    ai_runner.kill(holder.get("proc"))
    ai_runner.release(holder.get("lock"), holder.get("cwd"))
    os._exit(0)


def main():
    binary_stdio()
    message = read_message()
    if message is None:
        return
    if message.get("action") == "ai_run" and IS_WIN:
        send_message({"ok": False, "code": "platform", "error": "AI features are not available on Windows"})
        return
    if message.get("action") == "ai_run":  # (the only action that uses the user's subscription quota)
        serve_ai_run(message)
        return
    try:
        send_message(handle(message))
    except Exception as e:  # report every problem back to the extension
        send_message({"ok": False, "error": str(e)})


if __name__ == "__main__":
    main()
