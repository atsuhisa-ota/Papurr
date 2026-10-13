// Replace the final "navigate to the PDF" step so the test can see which file would be shown.
window.showInChrome = async (fileHandle) => { window.shownName = fileHandle.name; };
window.goTo = (url) => { window.wentTo = url; }; // ("Add to library" without a library tab: this page would become the library)
