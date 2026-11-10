(function () {
  'use strict';

  const W = 1536;
  const H = 1024;
  const world = document.getElementById('cv-world');
  const avatar = document.getElementById('cv-avatar');
  const dusk = document.querySelector('.cv-shade-dusk');
  const night = document.querySelector('.cv-shade-night');
  const stage = document.querySelector('.cv-stage');
  const door = document.getElementById('cv-door');
  const cvMe = document.getElementById('cv-me');

  const names = { yeti: '阿暖', yuki: '阿安' };
  const WALK = { minX: 70, maxX: 1470, minY: 590, maxY: 965 };
  const DOORSTEP = { x: 714, y: 692 };

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SPEED = reduced ? 150 : 300;

  let pos = { x: 770, y: 820 };
  let target = null;
  let pendingDoor = false;
  let facing = 1;
  let frame = 0;
  let bobY = 0;
  let last = performance.now();

  function shanghaiParts() {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const parts = fmt.formatToParts(new Date());
    let month = 1;
    let hour = 0;
    let minute = 0;
    for (const p of parts) {
      if (p.type === 'month') month = parseInt(p.value, 10);
      if (p.type === 'hour') hour = parseInt(p.value, 10);
      if (p.type === 'minute') minute = parseInt(p.value, 10);
    }
    if (hour >= 24) hour -= 24;
    return { month, h: hour + minute / 60 };
  }

  function applySeasonAndLight() {
    const { month, h } = shanghaiParts();

    let season = 'winter';
    if (month >= 3 && month <= 5) season = 'spring';
    else if (month >= 6 && month <= 8) season = 'summer';
    else if (month >= 9 && month <= 11) season = 'autumn';
    world.style.backgroundImage = `url(/static/pixel/town-climate-v9/${season}.png)`;

    let nightOpacity = 0;
    if (h >= 19 || h < 5) {
      nightOpacity = 0.55;
    } else if (h >= 17) {
      nightOpacity = ((h - 17) / 2) * 0.55;
    } else if (h >= 7) {
      nightOpacity = 0;
    } else if (h >= 5) {
      nightOpacity = ((7 - h) / 2) * 0.55;
    } else {
      nightOpacity = 0.55;
    }

    const duskOpacity = (h >= 16.5 && h < 19) ? 0.30 : 0;

    night.style.opacity = String(nightOpacity);
    dusk.style.opacity = String(duskOpacity);
  }

  function place() {
    avatar.style.left = (pos.x / W * 100) + '%';
    avatar.style.top = (pos.y / H * 100) + '%';

    let transform = 'translate(-50%,-100%)';
    if (facing < 0) transform += ' scaleX(-1)';
    if (bobY !== 0) transform += ` translateY(${bobY}px)`;
    avatar.style.transform = transform;
    avatar.style.backgroundPositionX = (frame * 33.3333) + '%';

    if (stage.scrollWidth > stage.clientWidth) {
      const avatarCenterPx = (pos.x / W) * world.clientWidth + world.offsetLeft;
      stage.scrollLeft = Math.max(0, Math.min(
        avatarCenterPx - stage.clientWidth / 2,
        stage.scrollWidth - stage.clientWidth
      ));
    }
  }

  function arrive() {
    pos = { ...target };
    target = null;
    frame = 0;
    bobY = 0;
    if (pendingDoor) {
      pendingDoor = false;
      location.href = '/community/house.html';
    }
  }

  function loop(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    if (target) {
      const dx = target.x - pos.x;
      const dy = target.y - pos.y;
      const dist = Math.hypot(dx, dy);

      if (dist < 6) {
        arrive();
      } else {
        const step = SPEED * dt;
        if (step >= dist) {
          pos.x = target.x;
          pos.y = target.y;
          arrive();
        } else {
          pos.x += (dx / dist) * step;
          pos.y += (dy / dist) * step;
          if (dx < -1) facing = -1;
          else if (dx > 1) facing = 1;
          frame = Math.floor(now / 110) % 4;
          bobY = reduced ? 0 : Math.sin(now / 90) * 3;
        }
      }
    } else {
      frame = 0;
      bobY = 0;
    }

    place();
    requestAnimationFrame(loop);
  }

  world.addEventListener('pointerdown', (e) => {
    if (e.target.closest('#cv-door')) return;

    const rect = world.getBoundingClientRect();
    const scaleX = W / rect.width;
    const scaleY = H / rect.height;
    const wx = (e.clientX - rect.left) * scaleX;
    const wy = (e.clientY - rect.top) * scaleY;

    target = {
      x: Math.max(WALK.minX, Math.min(WALK.maxX, wx)),
      y: Math.max(WALK.minY, Math.min(WALK.maxY, wy))
    };
    pendingDoor = false;
  });

  door.addEventListener('click', (e) => {
    e.stopPropagation();
    target = { ...DOORSTEP };
    pendingDoor = true;
  });

  async function fillMe() {
    try {
      const res = await fetch('/whoami', { credentials: 'same-origin' });
      const data = await res.json();
      const user = data && (data.user || data.u);
      if (user && names[user]) {
        cvMe.textContent = `你正以「${names[user]}」的身份串门`;
      } else {
        cvMe.textContent = '未登录';
      }
    } catch (e) {
      cvMe.textContent = '未登录';
    }
  }

  applySeasonAndLight();
  fillMe();
  place();
  requestAnimationFrame(loop);
})();
