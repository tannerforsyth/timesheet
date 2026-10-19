/**
 * AAA Timesheet page. Hosted on GitHub Pages; all data goes through the Apps
 * Script API (doPost in src/Code.js). No sign-in.
 *
 * Requests are POSTs with a text/plain JSON body (no CORS preflight) and
 * credentials omitted, so no Google cookies are ever sent. That's what keeps
 * phones signed in to several Google accounts from hitting Google's "unable
 * to open the file" page.
 */
(function () {
  'use strict';

  var API_URL = 'https://script.google.com/macros/s/AKfycbw9AqalkPA6WUunstccDG0rAM35Af2DMM2DrfEct7-KRk_LPrco2eHtV4CAm2h4malriQ/exec';
  var state = { boot: null, week: null, weekStart: null };

  var $ = function (id) { return document.getElementById(id); };

  // -----------------------------------------------------------------------
  // Server calls
  // -----------------------------------------------------------------------

  /** Calls an API action; resolves with its result or rejects with an Error. */
  function call(action, args) {
    if (window.FAKE_API) return window.FAKE_API(action, args || {});
    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, args: args || {} }),
      credentials: 'omit',
      redirect: 'follow'
    }).then(function (res) {
      if (!res.ok) throw new Error('The server didn\'t respond (' + res.status + '). Try again.');
      return res.json();
    }, function () {
      throw new Error('Couldn\'t reach the server. Check your connection and try again.');
    }).then(function (data) {
      if (!data.ok) throw new Error(data.error || 'Something went wrong.');
      return data.result;
    });
  }

  function errorText(err) {
    return String((err && err.message) || err || 'Something went wrong.').replace(/^Error:\s*/, '');
  }

  function start() {
    call('bootstrap').then(function (boot) {
      state.boot = boot;
      $('loading').hidden = true;
      $('app').hidden = false;
      loadWeek(boot.currentWeekStart);
    }, function (err) {
      $('loading').innerHTML = esc(errorText(err)) + ' <button class="link" type="button" id="retryBtn">Retry</button>';
      $('retryBtn').onclick = function () { $('loading').textContent = 'Loading…'; start(); };
    });
  }

  // -----------------------------------------------------------------------
  // Week view
  // -----------------------------------------------------------------------

  function loadWeek(weekStart) {
    state.weekStart = weekStart;
    $('days').innerHTML = '<div class="dayrow center muted">Loading…</div>';
    call('getWeek', { weekStart: weekStart }).then(renderWeek, function (err) {
      $('days').innerHTML = '<div class="dayrow center muted">' + esc(errorText(err)) + '</div>';
    });
  }

  function renderWeek(week) {
    state.week = week;
    state.weekStart = week.weekStart;
    state.boot.openSession = week.openSession;
    var today = state.boot.today;

    $('weekLabel').textContent = prettyRange(week.weekStart, week.weekEnd);
    $('weekTotal').textContent = fmtHours(week.total);
    $('thisWeek').hidden = week.weekStart === state.boot.currentWeekStart;
    $('nextWeek').disabled = week.weekStart >= state.boot.currentWeekStart;

    var chip = $('reportChip');
    chip.textContent = week.report.text;
    chip.className = 'chip ' + (week.report.code === 'sent' ? 'sent' : week.report.code === 'revised' ? 'revised' : '');
    $('reportChanged').hidden = !week.report.changed;

    var sent = week.report.code === 'sent' || week.report.code === 'revised';
    $('sendBtn').hidden = week.isFuture;
    $('sendBtn').textContent = sent ? 'Re-send (revised)' : 'Send report';

    var notice = $('lockNotice');
    if (week.locked) {
      notice.hidden = false;
      notice.innerHTML = 'This week locked on ' + esc(mdy(week.lockDate)) + '.' +
        ' Ask Tanner if something needs fixing.';
    } else if (week.unlocked) {
      notice.hidden = false;
      notice.innerHTML = 'Unlocked for editing (it had locked on ' + esc(mdy(week.lockDate)) + ').';
    } else {
      notice.hidden = true;
    }

    $('fab').hidden = !week.canEdit || week.isFuture;
    renderClock();

    var html = week.days.map(function (d) {
      var future = d.date > today;
      var entries = d.entries.map(function (e) {
        var time = fmt12(e.timeIn) + ' – ' + (e.open ? 'now (clocked in)' : fmt12(e.timeOut));
        return '<div class="entry' + (e.open ? ' open' : '') + (week.canEdit ? ' clickable' : '') + '" data-id="' + esc(e.id) + '">' +
          '<div class="entry-main"><div class="entry-time">' + esc(time) + '</div>' +
          '<div class="entry-work">' + (e.workCompleted ? esc(e.workCompleted) : '<span class="muted">No description yet</span>') + '</div></div>' +
          '<div class="entry-hours">' + (e.open ? '…' : fmtHours(e.hours) + ' h') + '</div></div>';
      }).join('');
      return '<div class="dayrow' + (d.date === today ? ' today' : '') + '">' +
        '<div class="day-head"><div><span class="day-name">' + d.dayName + '</span><span class="day-date">' + d.md +
        (d.date === today ? ' · today' : '') + '</span></div>' +
        '<div class="day-right"><span class="day-total">' + (d.total ? fmtHours(d.total) : '<span class="muted">—</span>') + '</span>' +
        (week.canEdit && !future ? '<button class="day-add" type="button" data-add="' + d.date + '" aria-label="Add time on ' + d.dayName + '">+</button>' : '') +
        '</div></div>' +
        entries +
        '</div>';
    }).join('');
    $('days').innerHTML = html;
  }

  function renderClock() {
    var area = $('clockArea');
    var open = state.boot.openSession;
    if (!open) {
      area.innerHTML = '<div class="card clock"><div><div class="label">Not clocked in</div>' +
        '<div class="muted small">Or add time after the fact with “Add entry”.</div></div>' +
        '<button class="btn primary" type="button" id="clockInBtn">Clock in</button></div>';
    } else if (open.stale) {
      area.innerHTML = '<div class="card clock stale"><div><div class="label">You’re still clocked in from ' + esc(open.label) + '.</div>' +
        '<div class="small">Enter the time you actually stopped.</div></div>' +
        '<button class="btn" type="button" id="fixClockBtn">Fix it</button></div>';
    } else {
      area.innerHTML = '<div class="card clock open"><div><div class="label">Clocked in since ' + esc(fmt12(open.timeIn)) + '</div>' +
        '<div class="muted small">' + esc(open.label) + '</div></div>' +
        '<button class="btn primary" type="button" id="clockOutBtn">Clock out</button></div>';
    }
  }

  // -----------------------------------------------------------------------
  // Entry form
  // -----------------------------------------------------------------------

  function findEntry(id) {
    var found = null;
    state.week.days.forEach(function (d) { d.entries.forEach(function (e) { if (e.id === id) found = e; }); });
    return found;
  }

  function openEntryForm(entry, defaults) {
    entry = entry || {};
    defaults = defaults || {};
    var isEdit = !!entry.id;
    var date = entry.date || defaults.date || state.boot.today;
    openSheet(
      '<h2>' + (isEdit ? 'Edit time' : 'Add time') + '</h2>' +
      '<label class="field"><span>Date</span><input type="date" id="fDate" max="' + state.boot.today + '" value="' + esc(date) + '"></label>' +
      '<div class="row2">' +
      '<label class="field"><span>Time in</span><input type="time" id="fIn" value="' + esc(entry.timeIn || '') + '"></label>' +
      '<label class="field"><span>Time out</span><input type="time" id="fOut" value="' + esc(entry.timeOut || '') + '"></label>' +
      '</div>' +
      '<div class="calc" id="fCalc"></div>' +
      '<label class="field"><span>Work completed</span><textarea id="fWork">' + esc(entry.workCompleted || '') + '</textarea></label>' +
      '<div id="fWarn"></div><div class="error" id="fErr" hidden></div>' +
      '<div class="sheet-actions">' +
      (isEdit ? '<button class="btn danger" type="button" id="fDelete">Delete</button>' : '') +
      '<button class="btn" type="button" id="fCancel">Cancel</button>' +
      '<button class="btn primary" type="button" id="fSave">Save</button>' +
      '</div>'
    );
    var confirmed = false;
    function recalc() {
      var tin = $('fIn').value, tout = $('fOut').value;
      if (tin && tout) {
        var mins = toMin(tout) - toMin(tin);
        $('fCalc').textContent = mins > 0 ? 'Hours: ' + fmtHours(Math.round(mins / 6) / 10) : 'Time out must be after time in.';
      } else if (tin && entry.open) {
        $('fCalc').textContent = entry.stale ? 'Enter the time you stopped working.' : 'Leave time out blank to stay clocked in.';
      } else {
        $('fCalc').textContent = '';
      }
      confirmed = false;
      $('fWarn').innerHTML = '';
      $('fSave').textContent = 'Save';
    }
    ['fIn', 'fOut', 'fDate'].forEach(function (id) { $(id).addEventListener('input', recalc); });
    recalc();
    $('fCancel').onclick = closeSheet;
    if (isEdit) $('fDelete').onclick = function () { confirmDelete(entry); };
    $('fSave').onclick = function () {
      var input = { id: entry.id || '', date: $('fDate').value, timeIn: $('fIn').value, timeOut: $('fOut').value, workCompleted: $('fWork').value };
      busy($('fSave'), true);
      $('fErr').hidden = true;
      call('saveEntry', { entry: input, confirmWarnings: confirmed }).then(function (res) {
        busy($('fSave'), false);
        if (!res.ok) {
          confirmed = true;
          $('fWarn').innerHTML = '<ul class="warn-list">' + res.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>';
          $('fSave').textContent = 'Save anyway';
          return;
        }
        closeSheet();
        renderWeek(res.week);
        toast('Saved');
      }, function (err) {
        busy($('fSave'), false);
        $('fErr').textContent = errorText(err);
        $('fErr').hidden = false;
      });
    };
    if (!isEdit) setTimeout(function () { $('fIn').focus(); }, 50);
  }

  function confirmDelete(entry) {
    openSheet(
      '<h2>Delete this entry?</h2>' +
      '<p>' + esc(mdy(entry.date)) + ', ' + esc(fmt12(entry.timeIn)) + (entry.timeOut ? ' – ' + esc(fmt12(entry.timeOut)) : '') + '</p>' +
      '<p class="muted">' + esc(entry.workCompleted || '') + '</p>' +
      '<div class="error" id="dErr" hidden></div>' +
      '<div class="sheet-actions"><button class="btn" type="button" id="dCancel">Keep it</button>' +
      '<button class="btn primary" type="button" id="dOk">Delete</button></div>'
    );
    $('dCancel').onclick = closeSheet;
    $('dOk').onclick = function () {
      busy($('dOk'), true);
      call('deleteEntry', { id: entry.id }).then(function (res) {
        closeSheet();
        renderWeek(res.week);
        toast('Deleted');
      }, function (err) {
        busy($('dOk'), false);
        $('dErr').textContent = errorText(err);
        $('dErr').hidden = false;
      });
    };
  }

  // -----------------------------------------------------------------------
  // Clock in / out
  // -----------------------------------------------------------------------

  function clockIn(btn) {
    busy(btn, true);
    call('clockIn').then(function (res) {
      renderWeek(res.week);
      toast('Clocked in');
    }, function (err) {
      busy(btn, false);
      toast(errorText(err));
    });
  }

  function clockOutForm() {
    var open = state.boot.openSession;
    openSheet(
      '<h2>Clock out</h2>' +
      '<p class="muted">Clocked in at ' + esc(fmt12(open.timeIn)) + '.</p>' +
      '<label class="field"><span>Work completed</span><textarea id="cWork">' + esc(open.workCompleted || '') + '</textarea></label>' +
      '<div class="error" id="cErr" hidden></div>' +
      '<div class="sheet-actions"><button class="btn" type="button" id="cCancel">Cancel</button>' +
      '<button class="btn primary" type="button" id="cOk">Clock out</button></div>'
    );
    setTimeout(function () { $('cWork').focus(); }, 50);
    $('cCancel').onclick = closeSheet;
    $('cOk').onclick = function () {
      busy($('cOk'), true);
      call('clockOut', { workCompleted: $('cWork').value }).then(function (res) {
        closeSheet();
        renderWeek(res.week);
        toast('Clocked out');
      }, function (err) {
        busy($('cOk'), false);
        if (errorText(err) === 'STALE_CLOCK_IN') { fixStaleClock(); return; }
        $('cErr').textContent = errorText(err);
        $('cErr').hidden = false;
      });
    };
  }

  /** Forgotten clock-out: open the edit form for the open session. */
  function fixStaleClock() {
    var open = state.boot.openSession;
    var weekStart = weekStartOf(open.date);
    var go = function () {
      openEntryForm({ id: open.id, date: open.date, timeIn: open.timeIn, timeOut: '', workCompleted: open.workCompleted, open: true, stale: true });
    };
    if (state.weekStart === weekStart) { go(); return; }
    call('getWeek', { weekStart: weekStart }).then(function (week) { renderWeek(week); go(); }, function (err) {
      toast(errorText(err));
    });
  }

  // -----------------------------------------------------------------------
  // Report
  // -----------------------------------------------------------------------

  function previewReport() {
    openSheet('<h2>Report preview</h2><div class="center muted" id="pLoading">Loading…</div>' +
      '<iframe class="preview-frame" id="pFrame" hidden title="Report preview"></iframe>' +
      '<div class="sheet-actions" style="margin-top:12px"><button class="btn" type="button" id="pClose">Close</button></div>');
    $('pClose').onclick = closeSheet;
    call('getReportPreview', { weekStart: state.weekStart }).then(function (res) {
      var html = res.html;
      $('pLoading').hidden = true;
      $('pFrame').hidden = false;
      $('pFrame').srcdoc = html;
    }, function (err) {
      $('pLoading').textContent = errorText(err);
    });
  }

  function confirmSend() {
    var week = state.week;
    var sent = week.report.code === 'sent' || week.report.code === 'revised';
    openSheet(
      '<h2>' + (sent ? 'Re-send as revised?' : 'Send report?') + '</h2>' +
      '<p>Week of ' + esc(prettyRange(week.weekStart, week.weekEnd)) + ' · <strong>' + fmtHours(week.total) + ' hours</strong></p>' +
      (sent
        ? '<p class="muted">This week was already sent (' + esc(week.report.text) + '). Lisa will get a copy marked REVISED' +
          (week.report.lastTotal != null ? ', showing the previous total of ' + fmtHours(week.report.lastTotal) + ' hours' : '') + '.</p>'
        : '<p class="muted">Lisa gets the PDF by email, and ' + esc(state.boot.workerName) + ' is CC\'d.</p>') +
      '<div class="error" id="sErr" hidden></div>' +
      '<div class="sheet-actions"><button class="btn" type="button" id="sCancel">Cancel</button>' +
      '<button class="btn primary" type="button" id="sOk">Send</button></div>'
    );
    $('sCancel').onclick = closeSheet;
    $('sOk').onclick = function () {
      busy($('sOk'), true);
      call('sendReport', { weekStart: week.weekStart }).then(function (res) {
        closeSheet();
        renderWeek(res.week);
        toast(res.revision ? 'Revised report sent' : 'Report sent');
      }, function (err) {
        busy($('sOk'), false);
        $('sErr').textContent = errorText(err);
        $('sErr').hidden = false;
      });
    };
  }

  // -----------------------------------------------------------------------
  // Sheet (modal), toast, formatting
  // -----------------------------------------------------------------------

  function openSheet(html) {
    $('sheet').innerHTML = html;
    $('overlay').hidden = false;
  }
  function closeSheet() {
    $('overlay').hidden = true;
    $('sheet').innerHTML = '';
  }

  var toastTimer = null;
  function toast(msg) {
    $('toast').textContent = msg;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $('toast').hidden = true; }, 3500);
  }

  function busy(btn, on) {
    if (!btn) return;
    btn.disabled = on;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtHours(n) { return (Math.round(Number(n || 0) * 10) / 10).toFixed(1); }
  function toMin(hm) { var p = hm.split(':'); return (+p[0]) * 60 + (+p[1]); }
  function fmt12(hm) {
    if (!hm) return '';
    var p = hm.split(':'), h = +p[0];
    return (h % 12 === 0 ? 12 : h % 12) + ':' + p[1] + ' ' + (h >= 12 ? 'PM' : 'AM');
  }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /** '2026-09-26', '2026-10-02' → 'Sep 26 – Oct 2, 2026' (the year shows once unless the week spans two). */
  function prettyRange(a, b) {
    var pa = a.split('-'), pb = b.split('-');
    var left = MONTHS[+pa[1] - 1] + ' ' + (+pa[2]) + (pa[0] !== pb[0] ? ', ' + pa[0] : '');
    return left + ' – ' + MONTHS[+pb[1] - 1] + ' ' + (+pb[2]) + ', ' + pb[0];
  }
  function mdy(ymd) { var p = ymd.split('-'); return (+p[1]) + '/' + (+p[2]) + '/' + p[0]; }
  function weekStartOf(ymd) {
    var p = ymd.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 1) % 7));
    return d.toISOString().slice(0, 10);
  }
  function shiftWeek(weekStart, n) {
    var p = weekStart.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + 7 * n));
    return d.toISOString().slice(0, 10);
  }

  // -----------------------------------------------------------------------
  // Wiring
  // -----------------------------------------------------------------------

  $('prevWeek').onclick = function () { loadWeek(shiftWeek(state.weekStart, -1)); };
  $('nextWeek').onclick = function () { loadWeek(shiftWeek(state.weekStart, 1)); };
  $('thisWeek').onclick = function () { loadWeek(state.boot.currentWeekStart); };
  $('jumpDate').addEventListener('change', function (e) { if (e.target.value) loadWeek(weekStartOf(e.target.value)); });
  $('previewBtn').onclick = previewReport;
  $('sendBtn').onclick = confirmSend;
  $('fab').onclick = function () {
    var today = state.boot.today;
    var inWeek = today >= state.week.weekStart && today <= state.week.weekEnd;
    openEntryForm(null, { date: inWeek ? today : state.week.weekEnd });
  };
  $('overlay').addEventListener('click', function (e) { if (e.target === $('overlay')) closeSheet(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('overlay').hidden) closeSheet(); });

  $('clockArea').addEventListener('click', function (e) {
    var t = e.target;
    if (t.id === 'clockInBtn') clockIn(t);
    else if (t.id === 'clockOutBtn') clockOutForm();
    else if (t.id === 'fixClockBtn') fixStaleClock();
  });
  $('days').addEventListener('click', function (e) {
    var add = e.target.closest('[data-add]');
    if (add) { openEntryForm(null, { date: add.getAttribute('data-add') }); return; }
    var row = e.target.closest('.entry');
    if (row && state.week.canEdit) {
      var entry = findEntry(row.getAttribute('data-id'));
      if (entry && entry.open) {
        if (state.boot.openSession && state.boot.openSession.stale) fixStaleClock();
        else clockOutForm();
      } else if (entry) {
        openEntryForm(entry);
      }
    }
  });

  start();
})();
