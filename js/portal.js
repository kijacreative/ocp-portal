/* Oak Cliff Pilates — Trainer HQ
   Side-nav scrollspy, accordions, and the live panels: announcements, events
   and the membership count, all from one read of the events workbook.

   Everything here talks to /api/hq/* on this origin. Those endpoints hold the
   workbook URL and its token, so this file carries no secrets — the browser
   never learns where the data actually comes from. */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* Text from the events sheet is data, never markup. */
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function when(ms) {
    var diff = Date.now() - ms;
    var mins = Math.round(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    var hours = Math.round(mins / 60);
    if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
    var days = Math.round(hours / 24);
    if (days < 7) return days + (days === 1 ? ' day ago' : ' days ago');
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function status(el, ok, text) {
    if (!el) return;
    el.className = 'hq-live' + (ok ? '' : ' hq-live--bad');
    el.innerHTML = '<span class="hq-live__dot"></span><span>' + esc(text) + '</span>';
  }

  /* ── Side nav ────────────────────────────────────────────────────── */
  function nav() {
    var links = $$('.hq-nav a');
    if (!links.length || !('IntersectionObserver' in window)) return;

    var sections = links
      .map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); })
      .filter(Boolean);

    var seen = {};
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) { seen[entry.target.id] = entry.intersectionRatio > 0; });
        var active = null;
        sections.forEach(function (section) { if (seen[section.id] && !active) active = section.id; });
        if (!active) return;
        links.forEach(function (a) {
          if (a.getAttribute('href') === '#' + active) a.setAttribute('aria-current', 'true');
          else a.removeAttribute('aria-current');
        });
      },
      { rootMargin: '-90px 0px -65% 0px', threshold: 0 }
    );
    sections.forEach(function (section) { observer.observe(section); });
  }

  /* ── Accordions ──────────────────────────────────────────────────── */
  function accordions() {
    $$('.hq-acc__btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!open));
        var panel = document.getElementById(btn.getAttribute('aria-controls'));
        if (panel) panel.hidden = open;
      });
    });
  }

  /* ── Announcements ───────────────────────────────────────────────── */
  function announcements(data) {
    var box = $('#hq-announcements');
    if (!box) return;
    var light = $('#hq-announcements-status');

    if (data.configured === false || data.announcementsConfigured === false) {
      box.innerHTML =
        '<div class="hq-empty">Announcements are not connected yet. They come from the ' +
        '<b>ANNOUNCEMENTS</b> tab in the events workbook.</div>';
      status(light, false, 'Not connected');
      return;
    }

    var items = data.announcements || [];
    if (!items.length) {
      box.innerHTML =
        '<div class="hq-empty">Nothing new right now.' +
        (data.error ? '<br><small>' + esc(data.error) + '</small>' : '') + '</div>';
      status(light, !data.error, data.error ? 'Feed error' : 'Up to date');
      return;
    }

    box.innerHTML = items
      .map(function (item) {
        var when = item.date ? new Date(item.date + 'T12:00:00') : null;
        var stamp = when && !isNaN(when)
          ? when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : '';
        var link = item.link
          ? '<p style="margin-top:8px"><a href="' + esc(item.link) +
            '" target="_blank" rel="noopener">' +
            esc(item.link.replace(/^https?:\/\//, '').slice(0, 60)) + '</a></p>'
          : '';
        return (
          '<article class="hq-post hq-post--note"><div>' +
          '<div class="hq-post__meta"><span class="hq-post__who">' + esc(item.title) + '</span>' +
          '<span class="hq-post__when">' + esc(stamp) + '</span></div>' +
          '<div class="hq-post__body">' + esc(item.body).replace(/\n/g, '<br>') + link + '</div>' +
          '</div></article>'
        );
      })
      .join('');
    status(light, true, 'From the events workbook');
  }

  /* ── Events ──────────────────────────────────────────────────────── */
  function tagFor(event) {
    var type = (event.type || '').toLowerCase();
    if (type.indexOf('partner') > -1) return { cls: 'badge--outline', text: event.type };
    if (type.indexOf('private') > -1) return { cls: 'badge--ink', text: event.type };
    if (event.type) return { cls: 'badge--gold', text: event.type };
    return { cls: 'badge--ink', text: event.format || 'Event' };
  }

  function eventCard(event) {
    var tag = tagFor(event);
    var tags = '<span class="badge ' + tag.cls + '">' + esc(tag.text) + '</span>';
    if (event.dateStatus && event.dateStatus.toLowerCase() !== 'confirmed') {
      tags += '<span class="badge badge--ink">' + esc(event.dateStatus) + '</span>';
    }
    if (event.format && event.format !== tag.text) {
      tags += '<span class="badge badge--ink">' + esc(event.format) + '</span>';
    }

    var teaching = event.instructors.map(function (p) { return p.name; }).join(', ');
    var pay = event.instructors
      .map(function (p) { return p.pay; })
      .filter(Boolean)
      .join(' / ');

    var meta = [
      ['Location', event.location],
      ['Teaching', teaching],
      ['Your pay', pay],
      ['Call time', event.callTime],
      ['Price', event.price],
      ['Capacity', event.capacity],
    ]
      .filter(function (pair) { return pair[1]; })
      .map(function (pair) {
        return '<div><b>' + esc(pair[0]) + '</b><span>' + esc(pair[1]) + '</span></div>';
      })
      .join('');

    var share = event.ticketUrl
      ? '<b>Share link</b><a href="' + esc(event.ticketUrl) + '" target="_blank" rel="noopener">' +
        esc(event.ticketUrl.replace(/^https?:\/\//, '')) + '</a>' +
        '<button type="button" class="hq-copy" data-copy="' + esc(event.ticketUrl) + '">Copy</button>'
      : '<b>Share link</b><em>Not in the sheet yet — add one in the event tab’s Ticket Link row.</em>';

    var scope = event.instructors
      .filter(function (p) { return p.scope; })
      .map(function (p) {
        return '<li><strong>' + esc(p.name) + ':</strong> ' + esc(p.scope) + '</li>';
      })
      .join('');

    return (
      '<article class="hq-event">' +
      '<div class="hq-event__date"><b>' + esc(event.day) + '</b><span>' + esc(event.month) + '</span>' +
      '<em>' + esc([event.weekday, event.time].filter(Boolean).join(' · ')) + '</em></div>' +
      '<div class="hq-event__body">' +
      '<div class="hq-event__tags">' + tags + '</div>' +
      '<h3 class="hq-h3">' + esc(event.name) + '</h3>' +
      (event.description ? '<p>' + esc(event.description) + '</p>' : '') +
      (event.discounts ? '<p>' + esc(event.discounts) + '</p>' : '') +
      '<div class="hq-meta">' + meta + '</div>' +
      (scope ? '<ul class="hq-list">' + scope + '</ul>' : '') +
      '<div class="hq-event__share">' + share + '</div>' +
      '</div></article>'
    );
  }

  function goal(config) {
    var box = $('#hq-goal-nums');
    if (!box) return;
    var now = Number(config.active_members);
    var target = Number(config.member_goal) || 1000;

    if (!now || !isFinite(now)) {
      // Better to say the count is missing than to show a dash and an empty
      // bar, which reads like the studio has no members.
      box.outerHTML =
        '<div class="hq-empty" id="hq-goal-nums">The member count is not connected yet. ' +
        'It comes from the <b>SITE CONFIG</b> tab in the events workbook.</div>';
      var railBox = $('.hq-rail');
      if (railBox) railBox.hidden = true;
      var stamp0 = $('#hq-goal-updated');
      if (stamp0) stamp0.hidden = true;
      return;
    }
    var shownRail = $('.hq-rail');
    if (shownRail) shownRail.hidden = false;

    var left = Math.max(target - now, 0);
    var pct = Math.min((now / target) * 100, 100);
    box.innerHTML =
      '<div class="hq-num hq-num--now"><b>' + now.toLocaleString('en-US') + '</b><span>Active members today</span></div>' +
      '<div class="hq-num"><b>' + left.toLocaleString('en-US') + '</b><span>Left to hit the goal</span></div>' +
      '<div class="hq-num"><b>' + target.toLocaleString('en-US') + '</b><span>' +
      esc(config.goal_label || 'The goal') + '</span></div>';

    var fill = $('#hq-rail-fill');
    if (fill) fill.style.width = pct.toFixed(1) + '%';
    var legend = $('#hq-rail-legend');
    if (legend) {
      legend.innerHTML =
        '<span>' + now.toLocaleString('en-US') + ' of ' + target.toLocaleString('en-US') + '</span>' +
        '<span>' + left.toLocaleString('en-US') + ' to go</span>';
    }
    var stamp = $('#hq-goal-updated');
    if (stamp && config.updated) stamp.textContent = 'Counted ' + config.updated;
  }

  function events() {
    var box = $('#hq-events');
    if (!box) return;
    var light = $('#hq-events-status');

    fetch('/api/hq/events', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        goal(data.config || {});
        announcements(data);

        if (data.configured === false) {
          box.innerHTML =
            '<div class="hq-empty">The events feed is not connected yet. ' +
            'The calendar itself is at <a href="https://events.oakcliffpilates.com" ' +
            'target="_blank" rel="noopener">events.oakcliffpilates.com</a>.</div>';
          status(light, false, 'Not connected');
          return;
        }
        if (!data.upcoming || !data.upcoming.length) {
          box.innerHTML =
            '<div class="hq-empty">No upcoming events in the workbook.' +
            (data.error ? '<br><small>' + esc(data.error) + '</small>' : '') + '</div>';
          status(light, !data.error, data.error ? 'Feed error' : 'Nothing scheduled');
          return;
        }

        box.innerHTML = data.upcoming.map(eventCard).join('');
        status(light, true, data.stale
          ? 'Showing the last good copy'
          : 'Live from ' + (data.eventSource || 'the feed'));
      })
      .catch(function () {
        box.innerHTML = '<div class="hq-empty">Could not load events. Try a refresh.</div>';
        status(light, false, 'Offline');
        status($('#hq-announcements-status'), false, 'Offline');
      });
  }

  /* ── Copy buttons ────────────────────────────────────────────────── */
  function copying() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('.hq-copy');
      if (!btn || !navigator.clipboard) return;
      navigator.clipboard.writeText(btn.getAttribute('data-copy')).then(function () {
        var was = btn.textContent;
        btn.textContent = 'Copied';
        setTimeout(function () { btn.textContent = was; }, 1600);
      });
    });
  }

  /* ── Report an issue ─────────────────────────────────────────────── */
  function issues() {
    var form = $('#hq-issue-form');
    if (!form) return;
    var out = $('#hq-issue-status');
    var button = $('button[type="submit"]', form);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = new FormData(form);
      out.textContent = 'Posting…';
      out.removeAttribute('data-tone');
      button.disabled = true;

      fetch('/api/hq/issue', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reporter: data.get('reporter'),
          location: data.get('location'),
          area: data.get('area'),
          detail: data.get('detail'),
          urgent: data.get('urgent') === 'on',
        }),
      })
        .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
        .then(function (result) {
          if (!result.ok) throw new Error(result.body.error || 'Could not log it.');
          out.textContent = 'Logged in the studio issues sheet. Thank you.';
          out.setAttribute('data-tone', 'ok');
          form.reset();
        })
        .catch(function (err) {
          out.textContent = err.message;
          out.setAttribute('data-tone', 'bad');
        })
        .finally(function () { button.disabled = false; });
    });
  }

  nav();
  accordions();
  copying();
  issues();
  events();
})();
