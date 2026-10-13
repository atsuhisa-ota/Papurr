#!/usr/bin/env python3
"""Register the helper with Chrome / Chromium / Brave / Edge (Linux, macOS and Windows).
Run once per computer; run it again if the extension folder moves.

Linux and macOS: a small manifest file in each browser's settings folder.
Windows: the manifest sits next to this file and each browser finds it through a registry key under
HKEY_CURRENT_USER (no administrator rights needed); the helper is started through a .bat launcher.
"""
import glob
import hashlib
import json
import os
import shlex
import stat
import sys

HOST_NAME = "com.paper_folder_manager.opener"
HERE = os.path.dirname(os.path.abspath(__file__))
EXTENSION_DIR = os.path.join(os.path.dirname(HERE), "extension")
HELPER = os.path.join(HERE, "paper_opener.py")
LAUNCHER = os.path.join(HERE, "paper_opener_launcher.sh")  # macOS only (see write_launcher)
WIN_LAUNCHER = os.path.join(HERE, "paper_opener_launcher.bat")  # Windows only
WIN_MANIFEST = os.path.join(HERE, HOST_NAME + ".json")  # Windows only

# Where each browser keeps its settings (the native messaging registration goes into a folder inside it).
BROWSER_DIRS = {
    "linux": {
        "Google Chrome": "~/.config/google-chrome",
        "Chromium": "~/.config/chromium",
        "Brave": "~/.config/BraveSoftware/Brave-Browser",
        "Microsoft Edge": "~/.config/microsoft-edge",
    },
    "darwin": {
        "Google Chrome": "~/Library/Application Support/Google/Chrome",
        "Chromium": "~/Library/Application Support/Chromium",
        "Brave": "~/Library/Application Support/BraveSoftware/Brave-Browser",
        "Microsoft Edge": "~/Library/Application Support/Microsoft Edge",
    },
}
# Windows: (profile folder under %LOCALAPPDATA%, registry key under HKEY_CURRENT_USER)
WIN_BROWSERS = {
    "Google Chrome": ("Google\\Chrome\\User Data", "Software\\Google\\Chrome\\NativeMessagingHosts\\" + HOST_NAME),
    "Chromium": ("Chromium\\User Data", "Software\\Chromium\\NativeMessagingHosts\\" + HOST_NAME),
    "Brave": ("BraveSoftware\\Brave-Browser\\User Data", "Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\" + HOST_NAME),
    "Microsoft Edge": ("Microsoft\\Edge\\User Data", "Software\\Microsoft\\Edge\\NativeMessagingHosts\\" + HOST_NAME),
}


def computed_extension_id(path, windows=False):
    """Chrome derives the ID of an unpacked extension from its folder path (on Windows: the UTF-16 path)."""
    digest = hashlib.sha256(path.encode("utf-16-le" if windows else "utf-8")).hexdigest()[:32]
    return "".join(chr(ord("a") + int(c, 16)) for c in digest)


def computed_ids(extension_dir, windows=False):
    if not windows:
        return {computed_extension_id(extension_dir)}
    # (the drive letter may be written either way)
    variants = {extension_dir, extension_dir[:1].upper() + extension_dir[1:], extension_dir[:1].lower() + extension_dir[1:]}
    return {computed_extension_id(v, True) for v in variants}


def ids_from_browser(config_dir, extension_dir):
    """The IDs under which a browser has actually loaded this unpacked extension (read from its profiles)."""
    found = set()
    wanted = os.path.normcase(os.path.realpath(extension_dir))
    for prefs in glob.glob(os.path.join(os.path.expanduser(config_dir), "*", "*Preferences")):
        try:
            with open(prefs, encoding="utf-8") as f:
                settings = json.load(f).get("extensions", {}).get("settings", {})
        except (OSError, ValueError):
            continue
        for ext_id, info in settings.items():
            path = info.get("path") if isinstance(info, dict) else None
            if path and os.path.normcase(os.path.realpath(path)) == wanted:
                found.add(ext_id)
    return found


def write_launcher(python):
    """On macOS, Chrome starts helpers with a minimal PATH, so `python3` may not be found.
    This tiny script starts the helper with exactly the Python that ran this installer."""
    with open(LAUNCHER, "w", encoding="utf-8") as f:
        f.write("#!/bin/sh\nexec %s %s \"$@\"\n" % (shlex.quote(python), shlex.quote(HELPER)))
    os.chmod(LAUNCHER, os.stat(LAUNCHER).st_mode | stat.S_IXUSR | stat.S_IRUSR)
    return LAUNCHER


def write_win_launcher(python):
    """Chrome on Windows starts helpers through a .exe or .bat file: this one runs the helper with this Python."""
    command = '"%s" "%s" %%*\n' % (python, HELPER)
    try:  # cmd.exe reads .bat files in the console code page; a path it cannot write (e.g. a Japanese user name) switches to UTF-8
        command.encode("oem")
        encoding, text = "oem", "@echo off\n" + command
    except (LookupError, UnicodeEncodeError):
        encoding, text = "utf-8", "@echo off\nchcp 65001 >nul\n" + command
    with open(WIN_LAUNCHER, "w", encoding=encoding, newline="\r\n") as f:
        f.write(text)
    return WIN_LAUNCHER


def manifest_for(program, ids):
    return {
        "name": HOST_NAME,
        "description": "Opens PDFs from the Papurr papers folder in an external app",
        "path": program,
        "type": "stdio",
        "allowed_origins": ["chrome-extension://" + i + "/" for i in sorted(ids)],
    }


def install_windows(python, local_app_data=None, registry=None):
    """Register on Windows: one manifest next to this file, one registry key per installed browser."""
    if registry is None:
        import winreg as registry
    local_app_data = local_app_data or os.environ.get("LOCALAPPDATA", "")
    program = write_win_launcher(python)
    found = {name: dirs for name, dirs in WIN_BROWSERS.items() if os.path.isdir(os.path.join(local_app_data, dirs[0]))}
    ids = set(computed_ids(EXTENSION_DIR, windows=True))
    for profiles, _ in found.values():
        ids |= ids_from_browser(os.path.join(local_app_data, profiles), EXTENSION_DIR)
    with open(WIN_MANIFEST, "w", encoding="utf-8") as f:
        json.dump(manifest_for(program, ids), f, indent=2)
    for name, (_, key) in found.items():
        with registry.CreateKey(registry.HKEY_CURRENT_USER, key) as k:
            registry.SetValueEx(k, "", 0, registry.REG_SZ, WIN_MANIFEST)
        print("Registered for %s" % name)
    if not found:
        print("No supported browser found.")
    return list(found)


def install(platform=None, home=None, python=None):
    """Register the helper. Returns the list of browsers it was registered for."""
    platform = platform or {"darwin": "darwin", "win32": "win32"}.get(sys.platform, "linux")
    if platform == "win32":
        return install_windows(python or sys.executable)
    if platform not in BROWSER_DIRS:
        raise SystemExit("This installer supports Linux, macOS and Windows.")
    if home:
        os.environ["HOME"] = home  # (used by the tests)
    os.chmod(HELPER, os.stat(HELPER).st_mode | stat.S_IXUSR)
    program = write_launcher(python or sys.executable) if platform == "darwin" else HELPER

    registered = []
    for name, config in BROWSER_DIRS[platform].items():
        if not os.path.isdir(os.path.expanduser(config)):
            continue
        ids = computed_ids(EXTENSION_DIR) | ids_from_browser(config, EXTENSION_DIR)
        manifest = manifest_for(program, ids)
        target = os.path.join(os.path.expanduser(config), "NativeMessagingHosts")
        os.makedirs(target, exist_ok=True)
        with open(os.path.join(target, HOST_NAME + ".json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)
        print("Registered for %s (extension ID: %s)" % (name, ", ".join(sorted(ids))))
        registered.append(name)
    if not registered:
        print("No supported browser found.")
    return registered


if __name__ == "__main__":
    install()
