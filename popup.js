document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('username');
  const addBtn = document.getElementById('addBtn');
  const clearBtn = document.getElementById('clearBtn');
  const friendList = document.getElementById('friendList');

  // Initialize: Load friends from Chrome storage
  const loadFriends = () => {
    chrome.storage.local.get({ friends: [] }, (result) => {
      friendList.innerHTML = ''; 
      result.friends.forEach(friend => addFriendToUI(friend));
    });
  };

  // Add a new friend to the tracker
  addBtn.addEventListener('click', () => {
    const username = input.value.trim();
    if (!username) return;

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
  });

  // Clear the whole list
  clearBtn.addEventListener('click', () => {
    chrome.storage.local.set({ friends: [] }, () => {
      friendList.innerHTML = '';
    });
  });

  // Create UI elements and fetch the solved count
  async function addFriendToUI(username) {
    const row = document.createElement('div');
    row.className = 'friend-row';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = username;

    const countSpan = document.createElement('span');
    countSpan.className = 'count';
    countSpan.textContent = '...'; // Loading state

    row.appendChild(nameSpan);
    row.appendChild(countSpan);
    friendList.appendChild(row);

    try {
      const count = await fetchTodaySolved(username);
      countSpan.textContent = count;
    } catch (err) {
      countSpan.textContent = 'Err';
      countSpan.style.color = 'red';
    }
  }

  // Core API Logic: Fetch unique 'Accepted' problems for today
  async function fetchTodaySolved(username) {
    // Fetch the 100 most recent submissions (usually more than enough for one day)
    const res = await fetch(`https://codeforces.com/api/user.status?handle=${username}&from=1&count=100`);
    const data = await res.json();

    if (data.status !== 'OK') throw new Error('API Error');

    // Calculate the start of "today" in local time (Unix timestamp in seconds)
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;

    const uniqueProblems = new Set();

    for (const sub of data.result) {
      // Submissions are ordered newest first. Stop checking if we hit yesterday.
      if (sub.creationTimeSeconds < startOfDay) {
         break; 
      }

      // 'OK' is the Codeforces verdict for Accepted
      if (sub.verdict === 'OK') {
         // Create a unique ID for the problem (e.g., "1500-A")
         const problemId = `${sub.problem.contestId}-${sub.problem.index}`;
         uniqueProblems.add(problemId);
      }
    }

    return uniqueProblems.size;
  }

  // Run on startup
  loadFriends();
});