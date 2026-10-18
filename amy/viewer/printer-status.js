/* Generated from printer_status.py: keep frontend routing in sync with the server. */
(() => {
  const prefix = new RegExp("^(?:tell me|show me|let me know|find out|check(?: on)?|give me)\\b[ ,:]*", 'i');
  const reference = new RegExp("\\b(?:big ?boy|big ?girl|little ?boy|h2[dc]|x1c?|o1c2|greyhound|voron|printers?|fleet|bench|bambu)\\b", 'i');
  const visual = new RegExp("\\b(?:first layer|camera|appearance|quality|surface|defect|look|looks|looking)\\b", 'i');
  const patterns = ["^(?:what(?:'s| is| are)|which)\\b.*\\b(?:printing|running|doing|status|state|current (?:job|print))\\b", "^what(?:'s| is| are)(?: currently)? on\\b", "^(?:what|which) (?:print|job|file|model)\\b.*\\b(?:on|printing|running|current|now)\\b", "^how(?:'s| is| are| far| long| much time)\\b", "^when\\b.*\\b(?:finish|finished|done|complete|ready)\\b", "^(?:is|are|has|have|did|does)\\b.*\\b(?:printing|running|paused|finished|done|complete|idle|ready|online|offline|stopped|busy|working|connected|cancelled|failed)\\b", "^(?:the |current |live )?(?:printer |fleet |bench )?(?:status|state|progress|time left|time remaining|current job|current print)\\b", "^.+?\\b(?:status|state|progress|time left|time remaining|current job|current print)$"].map(p => new RegExp(p, 'i'));
  window.AmyPrinterStatus = {handles(text) {
    let q = String(text).replace(/’/g, "'").replace(/\s+/g,' ').trim();
    for (let i=0;i<5;i++) q=q.replace(/^(?:hey amy|amy|hey|please|can you|could you|would you)\b[ ,:]*/i,'');
    q=q.replace(/(?:[, ]+(?:please|thanks|thank you))?[.!?]*$/i,'').trim();
    for (let i=0;i<3;i++) q=q.replace(prefix,'');
    return !visual.test(q) && (reference.test(q) || /\b(?:printing|printers)\b/i.test(q)) && patterns.some(p=>p.test(q));
  }};
})();
