/**
 * 1688 MAIN World Script — v0.5.2
 *
 * Runs in the MAIN world (not ISOLATED) to access window.__INIT_DATA and window.context
 * which are blocked from content scripts by Chrome's world isolation.
 *
 * Communicates with the ISOLATED content script via CustomEvent bridge:
 *   ext-req (request): ISOLATED → MAIN, asks for window data
 *   ext-res (response): MAIN → ISOLATED, sends back data + nodeMap desc
 */
(function () {
  'use strict';

  document.addEventListener('ext-req', function (event) {
    if (!event.detail || event.detail.action !== 'getWindowData') return;

    var result = null;
    var source = null;

    // Try __INIT_DATA first (older 1688 template)
    if (typeof window.__INIT_DATA !== 'undefined' && window.__INIT_DATA !== null) {
      result = window.__INIT_DATA;
      source = '__INIT_DATA';
    }
    // Try window.context (newer 2026 template)
    else try {
      if (window.context) {
        result = window.context;
        source = 'window.context';
      }
    } catch(e) {}

    // Collect nodeMap desc for detail HTML fallback
    var nodeMapDesc = null;
    try {
      var nm = window.nodeMap;
      if (nm && nm.module_description) {
        var pd = nm.module_description.privateData && nm.module_description.privateData.productDescription;
        if (pd && pd.details && Array.isArray(pd.details)) {
          nodeMapDesc = pd.details;
        }
      }
    } catch(e) {}

    var response = new CustomEvent('ext-res', {
      detail: {
        action: 'getWindowData',
        source: source,
        data: result,
        nodeMapDesc: nodeMapDesc,
        success: result !== null,
      },
    });
    document.dispatchEvent(response);
  });
})();
