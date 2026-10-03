/* Pure interaction rules for the panel. UI files call these; tests lock them.
   Pointer: left-drag pans. Pick reference endpoints takes the next left clicks.
   Space or middle button still pans. Inset and armed crop own the left button.
   Inset ratio: a menu commit younger than 400ms wins over CEP's stuck 1:1 value.
   Host: one Illustrator script at a time; a click drops queued background polls. */
(function (root) {
  'use strict';

  function previewPointerAction(s) {
    var endpointPick = !!(s && s.endpointPick);
    var button = s ? s.button : 0;
    var space = !!(s && s.space);
    var handPan = button === 0 && !space && !(s && s.samplePick) && !(s && s.straighten)
      && (!s || s.marqueeMode !== 'inset') && !(s && s.cropArmed) && !endpointPick;
    if (endpointPick && button === 0 && !space) { return 'pick'; }
    if (button === 1 || (button === 0 && space) || handPan) { return 'pan'; }
    if (!(s && s.cropDrag) && ((s && s.altKey) || (s && s.shiftKey)) && (s && s.hasPreview)
        && !(s && s.samplePick) && !endpointPick && !(s && s.onHandle)) {
      return 'compare';
    }
    return 'marquee';
  }

  /* Quiet polls often arrive with a null item or a blank key. That is not a new object. */
  function shouldCancelEndpointPick(picking, item, pickKey) {
    return !!(picking && item && pickKey && item.objectKey && item.objectKey !== pickKey);
  }

  /* Returns { queue, accepted, dropped }. Does not mutate the input queue. */
  function acceptHostJob(queue, pumping, job) {
    var next = (queue || []).slice();
    var dropped = [];
    var i;
    var background = !!(job && job.background);
    var hasUser = false;
    if (!background) {
      for (i = next.length - 1; i >= 0; i -= 1) {
        if (next[i].background) { dropped.push(next.splice(i, 1)[0]); }
      }
      next.unshift(job);
      return { queue: next, accepted: true, dropped: dropped };
    }
    for (i = 0; i < next.length; i += 1) {
      if (!next[i].background) { hasUser = true; break; }
    }
    if (hasUser || pumping) {
      return { queue: next, accepted: false, dropped: dropped };
    }
    next.push(job);
    return { queue: next, accepted: true, dropped: dropped };
  }

  root.PaperFigInteraction = {
    previewPointerAction: previewPointerAction,
    shouldCancelEndpointPick: shouldCancelEndpointPick,
    acceptHostJob: acceptHostJob
  };
}(typeof window !== 'undefined' ? window : global));
