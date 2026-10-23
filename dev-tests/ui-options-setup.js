window.permRequests = []; window.permDeny = false;
window.permAsked = []; window.notifyLevel = "granted"; window.notifyGranted = new Set();
chrome.permissions = { request: async ({ origins = [], permissions = [] }) => { permRequests.push(...origins); permAsked.push(...permissions); if (permDeny) return false; permissions.forEach((p) => notifyGranted.add(p)); return true; }, contains: async ({ permissions = [] }) => permissions.every((p) => notifyGranted.has(p)), remove: async () => true };
chrome.notifications = { getPermissionLevel: async () => notifyLevel };
window.loadDir = async () => (window.chosen ? fakeDir : null);
const _save = window.saveDir; window.saveDir = async (h) => { window.chosen = true; };
