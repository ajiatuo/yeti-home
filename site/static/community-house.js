(function () {
  'use strict';

  const cvMe = document.getElementById('cv-me');
  const panelEl = document.getElementById('hs-panel');
  const panelTitle = document.getElementById('hs-panel-title');
  const panelBody = document.getElementById('hs-panel-body');
  const closeBtn = document.getElementById('hs-close');
  const doorBtn = document.getElementById('hs-door');

  const names = { yeti: '阿暖', yuki: '阿安' };
  const panelTitles = {
    shelf: '书架 · 两个人的角落',
    sofa: '沙发 · 屋主的话',
    desk: '书桌 · 留言簿'
  };

  let house = null;
  let me = null;
  let messages = [];
  let currentPanel = null;

  function formatTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function canDelete(msg) {
    if (!me || !msg.user) return false;
    if (me === msg.user) return true;
    if (house && Array.isArray(house.owners) && house.owners.includes(me)) return true;
    return false;
  }

  function renderShelf() {
    const items = [
      { label: '阿暖的博客', href: '/blog/', avatar: '/static/pixel/avatar-yeti.png' },
      { label: '阿暖的随手记', href: '/yeti/', avatar: '/static/pixel/avatar-yeti.png' },
      { label: '阿安的博客', href: '/blog/', avatar: '/static/pixel/avatar-yuki.png' },
      { label: '阿安的随手记', href: '/yuki/', avatar: '/static/pixel/avatar-yuki.png' }
    ];

    items.forEach(item => {
      const a = document.createElement('a');
      a.className = 'hs-link';
      a.href = item.href;

      const img = document.createElement('img');
      img.src = item.avatar;
      img.alt = '';

      const span = document.createElement('span');
      span.textContent = item.label;

      a.append(img, span);
      panelBody.appendChild(a);
    });
  }

  function renderSofa() {
    const wrap = document.createElement('div');
    wrap.className = 'hs-sofa';

    const greet = document.createElement('p');
    greet.textContent = house ? house.greeting : '加载中…';

    const owners = document.createElement('p');
    if (house && Array.isArray(house.ownerNames)) {
      owners.textContent = `屋主：${house.ownerNames.join('、')}`;
    } else {
      owners.textContent = '屋主：阿暖、阿安';
    }

    const note = document.createElement('p');
    note.textContent = '这是社区的第一间样板房，布置还会慢慢长。';

    wrap.append(greet, owners, note);
    panelBody.appendChild(wrap);
  }

  function renderMessages() {
    const list = document.getElementById('gb-list');
    if (!list) return;

    list.textContent = '';

    if (!messages.length) {
      const empty = document.createElement('div');
      empty.className = 'gb-empty';
      empty.textContent = '还没有留言，来做第一个串门的人吧。';
      list.appendChild(empty);
      return;
    }

    messages.forEach(msg => {
      const item = document.createElement('div');
      item.className = 'gb-item';

      const meta = document.createElement('div');
      meta.className = 'gb-meta';

      const info = document.createElement('span');
      info.textContent = `${msg.name || '访客'} · ${formatTime(msg.ts)}`;
      meta.appendChild(info);

      if (canDelete(msg)) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'gb-del';
        del.textContent = '删除';
        del.addEventListener('click', () => deleteMessage(msg.id));
        meta.appendChild(del);
      }

      const text = document.createElement('div');
      text.className = 'gb-text';
      text.textContent = msg.text;

      item.append(meta, text);
      list.appendChild(item);
    });
  }

  function createForm() {
    const form = document.createElement('form');
    form.id = 'gb-form';

    const textarea = document.createElement('textarea');
    textarea.id = 'gb-text';
    textarea.maxLength = 200;
    textarea.rows = 3;
    textarea.placeholder = '给这家人留句话…';

    const btn = document.createElement('button');
    btn.type = 'submit';
    btn.textContent = '留 言';

    form.append(textarea, btn);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = textarea.value.trim();
      if (!text) return;

      try {
        const res = await fetch('/api/house/sample/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ action: 'create', text })
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          messages = data.messages || [];
          textarea.value = '';
          renderMessages();
        } else {
          alert(data.error || '留言失败');
        }
      } catch (err) {
        alert('留言失败');
      }
    });

    return form;
  }

  async function deleteMessage(id) {
    try {
      const res = await fetch('/api/house/sample/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action: 'delete', id })
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        messages = data.messages || [];
        renderMessages();
      } else {
        alert(data.error || '删除失败');
      }
    } catch (e) {
      alert('删除失败');
    }
  }

  function renderDesk() {
    const list = document.createElement('div');
    list.id = 'gb-list';
    panelBody.appendChild(list);
    renderMessages();
    panelBody.appendChild(createForm());
  }

  function renderPanel(panel) {
    panelBody.textContent = '';
    if (panel === 'shelf') renderShelf();
    else if (panel === 'sofa') renderSofa();
    else if (panel === 'desk') renderDesk();
  }

  function openPanel(panel) {
    currentPanel = panel;
    panelTitle.textContent = panelTitles[panel] || '';
    panelEl.hidden = false;
    renderPanel(panel);
  }

  closeBtn.addEventListener('click', () => {
    panelEl.hidden = true;
    currentPanel = null;
    panelBody.textContent = '';
  });

  doorBtn.addEventListener('click', () => {
    location.href = '/community/';
  });

  document.querySelectorAll('.hs-hot[data-panel]').forEach(btn => {
    btn.addEventListener('click', () => {
      openPanel(btn.dataset.panel);
    });
  });

  async function fillMe() {
    try {
      const res = await fetch('/whoami', { credentials: 'same-origin' });
      const data = await res.json();
      const user = data && (data.user || data.u);
      if (user) {
        me = user;
        cvMe.textContent = `你正以「${names[user] || user}」的身份串门`;
      } else {
        cvMe.textContent = '未登录';
      }
    } catch (e) {
      cvMe.textContent = '未登录';
    }
  }

  async function loadHouse() {
    try {
      const res = await fetch('/api/house/sample', { credentials: 'same-origin' });
      const data = await res.json();
      if (res.ok) {
        house = data.house || null;
        me = data.me || me;
        messages = data.messages || [];
        if (currentPanel === 'sofa' || currentPanel === 'desk') {
          renderPanel(currentPanel);
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  fillMe().then(() => loadHouse());
})();
