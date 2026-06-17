document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('username');
  const addBtn = document.getElementById('addBtn');
  const importBtn = document.getElementById('importBtn');
  const clearBtn = document.getElementById('clearBtn');
  const graphToggle = document.getElementById('graphToggle');
  const friendList = document.getElementById('friendList');
  const graphArea = document.getElementById('graphArea');
  const canvas = document.getElementById('graphCanvas');

  let graphVisible = false;
  let chartInstance = null;

  // ---------- Colour from rating (official CF ranges) ----------
  function colorFromRating(rating) {
    if (rating < 1200) return '#808080';                     // Newbie
    if (rating < 1400) return '#008000';                     // Pupil
    if (rating < 1600) return '#03a89e';                     // Specialist
    if (rating < 1900) return '#0000ff';                     // Expert
    if (rating < 2100) return '#aa00aa';                     // Candidate Master
    if (rating < 2400) return '#ff8c00';                     // Master / IM
    return '#ff0000';                                         // GM / IGM / LGM
  }

  // ---------- Storage helpers (friends list + user info cache) ----------
  const loadFriends = () => {
    chrome.storage.local.get({ friends: [], userCache: {} }, (result) => {
      friendList.innerHTML = '';
      result.friends.forEach(friend => addFriendToUI(friend, result.userCache));
      // Refresh data silently
      refreshAllUsers();
    });
  };

  // ---------- Cache user info (rating, colour) ----------
  async function getCachedUserInfo(username) {
    return new Promise(resolve => {
      chrome.storage.local.get({ userCache: {} }, (result) => {
        const cache = result.userCache;
        if (cache[username] && cache[username].updatedAt) {
          // Use cache if less than 24 hours old
          const hoursSinceUpdate = (Date.now() - cache[username].updatedAt) / 36e5;
          if (hoursSinceUpdate < 24) {
            resolve(cache[username]);
            return;
          }
        }
        // Fetch fresh
        fetchUserInfo(username).then(info => {
          if (info) {
            const entry = {
              handle: username,
              rating: info.rating || 0,
              maxRating: info.maxRating || 0,
              rank: info.rank || '',
              color: colorFromRating(info.rating || 0),
              updatedAt: Date.now()
            };
            cache[username] = entry;
            chrome.storage.local.set({ userCache: cache });
            resolve(entry);
          } else {
            resolve(null);
          }
        }).catch(() => resolve(null));
      });
    });
  }

  // ---------- Refresh all displayed users (today's count + info) ----------
  async function refreshAllUsers() {
    const rows = document.querySelectorAll('.friend-row');
    for (const row of rows) {
      const username = row.dataset.handle;
      if (!username) continue;
      // Update today's solved count
      try {
        const count = await fetchTodaySolved(username);
        row.querySelector('.count').textContent = count;
      } catch {
        row.querySelector('.count').textContent = 'Err';
      }
      // Update colour and tooltip
      const info = await getCachedUserInfo(username);
      if (info) {
        const nameSpan = row.querySelector('.name');
        nameSpan.style.color = info.color;
        nameSpan.title = `Rating: ${info.rating}`;
      }
    }
  }

  // ---------- Add / Import ----------
  addBtn.addEventListener('click', () => {
    const username = input.value.trim();
    if (!username) return;
    addFriend(username);
  });

  importBtn.addEventListener('click', async () => {
    importBtn.disabled = true;
    importBtn.textContent = 'Importing…';
    try {
      const imported = await importFriendsFromCF();
      if (imported.length) {
        imported.forEach(username => addFriend(username));
      } else {
        alert('No friends found. Are you logged into Codeforces?');
      }
    } catch (err) {
      console.error(err);
      alert('Failed to import. Make sure you are logged in on codeforces.com.');
    } finally {
      importBtn.disabled = false;
      importBtn.textContent = 'Import My Friends';
    }
  });

  function addFriend(username) {
    chrome.storage.local.get({ friends: [] }, (result) => {
      const friends = result.friends;
      if (!friends.includes(username)) {
        friends.push(username);
        chrome.storage.local.set({ friends }, () => {
          input.value = '';
          // Quickly render and then update
          addFriendToUI(username, {});
          refreshSingleUser(username);
        });
      } else {
        alert('User is already in your tracker!');
      }
    });
  }

  async function refreshSingleUser(username) {
    const row = document.querySelector(`.friend-row[data-handle="${username}"]`);
    if (!row) return;
    // Update count
    try {
      const count = await fetchTodaySolved(username);
      row.querySelector('.count').textContent = count;
    } catch {
      row.querySelector('.count').textContent = 'Err';
    }
    // Update colour
    const info = await getCachedUserInfo(username);
    if (info) {
      row.querySelector('.name').style.color = info.color;
      row.querySelector('.name').title = `Rating: ${info.rating}`;
    }
  }

  // ---------- UI rendering with delete & refresh buttons ----------
  function addFriendToUI(username, userCache = {}) {
    // Remove existing row if already present (avoid duplicates)
    const existing = document.querySelector(`.friend-row[data-handle="${username}"]`);
    if (existing) existing.remove();

    const row = document.createElement('div');
    row.className = 'friend-row';
    row.dataset.handle = username;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'name';
    nameSpan.textContent = username;
    nameSpan.style.cursor = 'default';

    // Use cached colour if available
    if (userCache[username] && userCache[username].color) {
      nameSpan.style.color = userCache[username].color;
      nameSpan.title = `Rating: ${userCache[username].rating}`;
    } else {
      nameSpan.style.color = '#000'; // placeholder
    }

    const countSpan = document.createElement('span');
    countSpan.className = 'count';
    countSpan.textContent = '...';

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'X';
    deleteBtn.style.marginLeft = '8px';
    deleteBtn.style.background = 'transparent';
    deleteBtn.style.border = 'none';
    deleteBtn.style.color = 'red';
    deleteBtn.style.cursor = 'pointer';
    deleteBtn.title = 'Remove friend';
    deleteBtn.onclick = () => removeFriend(username);

    row.appendChild(nameSpan);
    row.appendChild(countSpan);
    row.appendChild(deleteBtn);
    friendList.appendChild(row);
  }

  function removeFriend(username) {
    chrome.storage.local.get({ friends: [], userCache: {} }, (result) => {
      const friends = result.friends.filter(f => f !== username);
      // Optionally clean cache
      const userCache = result.userCache;
      // Keep cache to avoid re-fetching if re-added
      chrome.storage.local.set({ friends, userCache }, () => {
        const row = document.querySelector(`.friend-row[data-handle="${username}"]`);
        if (row) row.remove();
        if (chartInstance) chartInstance.destroy();
        graphArea.style.display = 'none';
        graphVisible = false;
        graphToggle.textContent = 'Show Graph';
      });
    });
  }

  clearBtn.addEventListener('click', () => {
    chrome.storage.local.set({ friends: [], userCache: {} }, () => {
      friendList.innerHTML = '';
      if (chartInstance) chartInstance.destroy();
      graphArea.style.display = 'none';
      graphVisible = false;
      graphToggle.textContent = 'Show Graph';
    });
  });

  // ---------- Core API ----------
  async function fetchTodaySolved(username) {
    const res = await fetch(`https://codeforces.com/api/user.status?handle=${username}&from=1&count=100`);
    const data = await res.json();
    if (data.status !== 'OK') throw new Error('API Error');
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
    const uniqueProblems = new Set();
    for (const sub of data.result) {
      if (sub.creationTimeSeconds < startOfDay) break;
      if (sub.verdict === 'OK') {
        uniqueProblems.add(`${sub.problem.contestId}-${sub.problem.index}`);
      }
    }
    return uniqueProblems.size;
  }

  async function fetchUserInfo(username) {
    const res = await fetch(`https://codeforces.com/api/user.info?handles=${username}`);
    const data = await res.json();
    if (data.status === 'OK' && data.result.length) return data.result[0];
    return null;
  }

  // ---------- Import from Codeforces friends page ----------
  async function importFriendsFromCF() {
    const res = await fetch('https://codeforces.com/friends', { credentials: 'include' });
    if (!res.ok) throw new Error('Not logged in?');
    const html = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const handles = [];
    doc.querySelectorAll('.friend a[href^="/profile/"]').forEach(a => {
      const href = a.getAttribute('href');
      if (href) {
        const username = href.replace('/profile/', '').trim();
        if (username) handles.push(username);
      }
    });
    return [...new Set(handles)];
  }

  // ---------- 7-day graph (unchanged, but uses cached colour when possible) ----------
  graphToggle.addEventListener('click', async () => {
    if (graphVisible) {
      hideGraph();
      return;
    }
    graphArea.style.display = 'block';
    graphToggle.textContent = 'Hide Graph';
    graphVisible = true;
    try {
      const friends = await getStoredFriends();
      if (!friends.length) throw new Error('No friends');

      const labels = [];
      const today = new Date();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        labels.push(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
      }

      const datasets = [];
      for (const friend of friends) {
        const daily = await getLast7DaysCount(friend);
        // Try cached colour first, else fetch live
        let color = '#888';
        const cached = await getCachedUserInfo(friend);
        if (cached && cached.color) {
          color = cached.color;
        } else {
          try {
            const info = await fetchUserInfo(friend);
            if (info) color = colorFromRating(info.rating || 0);
          } catch {}
        }
        datasets.push({
          label: friend,
          data: daily,
          borderColor: color,
          backgroundColor: 'transparent',
          tension: 0.2,
          pointRadius: 3,
        });
      }

      const ctx = canvas.getContext('2d');
      if (chartInstance) chartInstance.destroy();
      chartInstance = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
          responsive: true,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12, padding: 8 } }
          },
          scales: {
            y: { beginAtZero: true, ticks: { stepSize: 1 } }
          }
        }
      });
    } catch (err) {
      alert('Could not build graph: ' + err.message);
      hideGraph();
    }
  });

  function hideGraph() {
    graphArea.style.display = 'none';
    if (chartInstance) chartInstance.destroy();
    chartInstance = null;
    graphVisible = false;
    graphToggle.textContent = 'Show Graph';
  }

  function getStoredFriends() {
    return new Promise(resolve => {
      chrome.storage.local.get({ friends: [] }, result => resolve(result.friends));
    });
  }

  async function getLast7DaysCount(username) {
    const res = await fetch(`https://codeforces.com/api/user.status?handle=${username}&from=1&count=1000`);
    const data = await res.json();
    if (data.status !== 'OK') throw new Error('API Error');
    const now = new Date();
    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(now);
      day.setDate(now.getDate() - i);
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime() / 1000;
      days.push({ start, end: start + 86400, set: new Set() });
    }
    for (const sub of data.result) {
      if (sub.verdict !== 'OK') continue;
      const ts = sub.creationTimeSeconds;
      for (let i = 0; i < days.length; i++) {
        if (ts >= days[i].start && ts < days[i].end) {
          days[i].set.add(`${sub.problem.contestId}-${sub.problem.index}`);
          break;
        }
      }
    }
    // Transform to array [6 days ago .. today]
    const result = new Array(7).fill(0);
    for (let i = 0; i < 7; i++) {
      result[6 - i] = days[i].set.size;
    }
    return result;
  }

  // ---------- Add a manual Refresh button in the UI ----------
  const refreshBtn = document.createElement('button');
  refreshBtn.textContent = 'Refresh all';
  refreshBtn.style.marginLeft = '6px';
  refreshBtn.addEventListener('click', refreshAllUsers);
  document.getElementById('inputArea').appendChild(refreshBtn);

  // ---------- Initialise ----------
  loadFriends();
});