window.permRequests = []; window.permDeny = false;
chrome.permissions = { request: async ({ origins }) => { permRequests.push(...origins); return !permDeny; }, remove: async () => true };
window.loadDir = async () => (window.chosen ? fakeDir : null);
const _save = window.saveDir; window.saveDir = async (h) => { window.chosen = true; };
