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

  // ---------- Storage helpers ----------
  const loadFriends = () => {
    chrome.storage.local.get({ friends: [] }, (result) => {
      friendList.innerHTML = '';
      result.friends.forEach(friend => addFriendToUI(friend));
    });
  };

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
          addFriendToUI(username);
        });
      } else {
        alert('User is already in your tracker!');
      }
    });
  }

  clearBtn.addEventListener('click', () => {
    chrome.storage.local.set({ friends: [] }, () => {
      friendList.innerHTML = '';
      if (chartInstance) chartInstance.destroy();
      graphArea.style.display = 'none';
      graphVisible = false;
      graphToggle.textContent = 'Show Graph';
    });
  });

  // ---------- UI rendering with rank colour ----------
  async function addFriendToUI(username) {
    const row = document.createElement('div');
    row.className = 'friend-row';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = username;

    const countSpan = document.createElement('span');
    countSpan.className = 'count';
    countSpan.textContent = '...';

    row.appendChild(nameSpan);
    row.appendChild(countSpan);
    friendList.appendChild(row);

    // Fetch today's solved count
    try {
      const count = await fetchTodaySolved(username);
      countSpan.textContent = count;
    } catch {
      countSpan.textContent = 'Err';
      countSpan.style.color = 'red';
    }

    // Fetch user rank and colour the name
    try {
      const info = await fetchUserInfo(username);
      if (info && info.rank) {
        nameSpan.style.color = rankToColor(info.rank);
      }
    } catch { /* ignore */ }
  }

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

  function rankToColor(rank) {
    const map = {
      'newbie': '#808080',
      'pupil': '#008000',
      'specialist': '#03a89e',
      'expert': '#0000ff',
      'candidate master': '#aa00aa',
      'master': '#ff8c00',
      'international master': '#ff8c00',
      'grandmaster': '#ff0000',
      'international grandmaster': '#ff0000',
      'legendary grandmaster': '#ff0000'
    };
    return map[rank] || '#000';
  }

  // ---------- Import from friends page ----------
  async function importFriendsFromCF() {
    // Scrape the friends list using the active session cookie
    const res = await fetch('https://codeforces.com/friends', { credentials: 'include' });
    if (!res.ok) throw new Error('Not logged in?');
    const html = await res.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const handles = [];
    // Each friend is in a div with class "friend"; the username appears in an <a> like href="/profile/..."
    doc.querySelectorAll('.friend a[href^="/profile/"]').forEach(a => {
      const href = a.getAttribute('href');
      if (href) {
        const username = href.replace('/profile/', '').trim();
        if (username) handles.push(username);
      }
    });
    return [...new Set(handles)]; // unique
  }

  // ---------- 7-day graph ----------
  graphToggle.addEventListener('click', async () => {
    if (graphVisible) {
      hideGraph();
      return;
    }
    // Show graph
    graphArea.style.display = 'block';
    graphToggle.textContent = 'Hide Graph';
    graphVisible = true;
    try {
      const friends = await getStoredFriends();
      if (!friends.length) throw new Error('No friends');

      const datasets = [];
      const today = new Date();
      const labels = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        labels.push(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
      }

      // Fetch daily counts for each friend (last 7 days)
      for (const friend of friends) {
        const daily = await getLast7DaysCount(friend);
        // Get rank colour for the line
        let borderColor = '#888';
        try {
          const info = await fetchUserInfo(friend);
          if (info && info.rank) borderColor = rankToColor(info.rank);
        } catch {}
        datasets.push({
          label: friend,
          data: daily,
          borderColor,
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

  // Fetch last 7 days solved per day (local time)
  async function getLast7DaysCount(username) {
    // Fetch up to 1000 submissions – should cover a week for most active users
    const res = await fetch(`https://codeforces.com/api/user.status?handle=${username}&from=1&count=1000`);
    const data = await res.json();
    if (data.status !== 'OK') throw new Error('API Error');

    const now = new Date();
    const dailyCounts = Array(7).fill(0);
    // For each of the last 7 days, calculate start/end timestamps
    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(now);
      day.setDate(now.getDate() - i);
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime() / 1000;
      const end = start + 86400;
      days.push({ start, end, count: 0 });
    }

    const acceptedProblems = new Set(); // per day? We'll track unique problems per day
    // Because days are interleaved, we iterate submissions and bin them
    const daySets = days.map(() => new Set());

    for (const sub of data.result) {
      const ts = sub.creationTimeSeconds;
      if (sub.verdict !== 'OK') continue;
      // Find which day this submission belongs to
      for (let i = 0; i < days.length; i++) {
        if (ts >= days[i].start && ts < days[i].end) {
          const probId = `${sub.problem.contestId}-${sub.problem.index}`;
          daySets[i].add(probId);
          break;
        }
      }
    }

    // Return counts for the most recent day first? We want array from 6 days ago to today
    // daySets[0] is today, [1] yesterday, ..., [6] 6 days ago
    const result = new Array(7).fill(0);
    for (let i = 0; i < 7; i++) {
      // index 0 = today, index 6 = 6 days ago -> we want result[6] = daySets[0]?
      // We build labels from 6 days ago to today, so result[0] should be 6 days ago count.
      // daySets[0] = today, daySets[6] = 6 days ago.
      // So result[6-i] = daySets[i].size
      result[6 - i] = daySets[i].size;
    }
    return result;
  }

  // ---------- Initialise ----------
  loadFriends();
});