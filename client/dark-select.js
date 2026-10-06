/* PaperFig: dark custom dropdown for CEP <select> (avoids white native popup chrome). */
(function () {
  'use strict';
  var openMenu = null;
  var openSelect = null;

  function closeMenu() {
    if (openMenu && openMenu.parentNode) {
      openMenu.parentNode.removeChild(openMenu);
    }
    openMenu = null;
    openSelect = null;
  }

  function fireChange(select) {
    var evt;
    try {
      evt = new Event('change', { bubbles: true });
    } catch (err) {
      evt = document.createEvent('HTMLEvents');
      evt.initEvent('change', true, false);
    }
    select.dispatchEvent(evt);
  }

  function placeMenu(menu, select) {
    var rect = select.getBoundingClientRect();
    var pad = 4;
    var width = Math.max(rect.width, 120);
    var left = rect.left;
    var below = window.innerHeight - rect.bottom - pad - 2;
    var above = rect.top - pad - 2;
    var openUp = below < 120 && above > below;
    var maxH = Math.max(72, Math.min(280, openUp ? above : below));
    var top;
    menu.style.minWidth = width + 'px';
    menu.style.maxWidth = Math.max(width, 240) + 'px';
    menu.style.maxHeight = Math.round(maxH) + 'px';
    document.body.appendChild(menu);
    top = openUp ? Math.max(pad, rect.top - (menu.offsetHeight || maxH) - 2) : rect.bottom + 2;
    if (left + width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - width - pad);
    }
    if (left < pad) { left = pad; }
    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';
  }

  function openFor(select) {
    closeMenu();
    if (!select || select.disabled || select.multiple) { return; }
    var menu = document.createElement('div');
    menu.className = 'pf-dd-menu';
    menu.setAttribute('role', 'listbox');
    Array.prototype.forEach.call(select.options, function (opt, i) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'pf-dd-option'
        + (opt.disabled ? ' is-disabled' : '')
        + (opt.selected ? ' is-selected' : '');
      row.setAttribute('role', 'option');
      if (opt.selected) { row.setAttribute('aria-selected', 'true'); }
      row.textContent = opt.textContent;
      if (opt.disabled) {
        row.disabled = true;
      } else {
        row.addEventListener('mousedown', function (e) {
          e.preventDefault();
          e.stopPropagation();
          var chosen = select.options[i];
          var val = chosen ? String((chosen.getAttribute && chosen.getAttribute('value')) || chosen.value || chosen.text || chosen.textContent || '') : '';
          select.selectedIndex = i;
          try { if (val) { select.value = val; } } catch (ignoreVal) {}
          try { if (val) { select.setAttribute('data-pf-aspect', val); } } catch (ignoreAttr) {}
          try { if (val) { select.setAttribute('data-pf-user-aspect', val); } } catch (ignoreUser) {}
          if (window.__pfAspectChosen) {
            try { select.setAttribute('data-pf-skip-change', '1'); } catch (ignoreSkip) {}
            try { window.__pfAspectChosen(select.id, val); } catch (ignoreAspect) {}
          }
          fireChange(select);
          closeMenu();
        });
      }
      menu.appendChild(row);
    });
    placeMenu(menu, select);
    openMenu = menu;
    openSelect = select;
  }

  document.addEventListener('mousedown', function (e) {
    var t = e.target;
    if (openMenu && t && !openMenu.contains(t) && t !== openSelect) {
      closeMenu();
    }
    if (!t || t.tagName !== 'SELECT' || t.disabled || t.multiple) { return; }
    /* Intercept native popup; show dark custom list instead. */
    e.preventDefault();
    e.stopPropagation();
    if (openSelect === t) {
      closeMenu();
      return;
    }
    openFor(t);
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' || e.keyCode === 27) { closeMenu(); }
  }, true);

  window.addEventListener('resize', closeMenu);
  window.addEventListener('blur', closeMenu);
  document.addEventListener('scroll', closeMenu, true);
  document.addEventListener('paperfig-tab', closeMenu);
})();
