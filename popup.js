document.addEventListener('DOMContentLoaded', () => {
  const friendList = document.getElementById('friendList');
  const usernameInput = document.getElementById('username');
  const addBtn = document.getElementById('addBtn');
  const clearBtn = document.getElementById('clearBtn');

  function updateUI() {
    chrome.storage.local.get(['friends'], (result) => {
      const friends = result.friends || [];
      friendList.innerHTML = '';
      
      friends.forEach((friend, index) => {
        const div = document.createElement('div');
        div.className = 'friend-row';
        div.innerHTML = `<span>${friend.username}</span> <span class="count" id="c-${index}">...</span>`;
        friendList.appendChild(div);
        fetchData(friend, index);
      });
    });
  }

  async function fetchData(friend, index) {
    try {
      const response = await fetch(`https://codeforces.com/profile/${friend.username}`);
      const text = await response.text();
      const match = text.match(/<div class="_UserActivityFrame_counterValue">(\d+)\s+problems<\/div>/);
      
      if (match) {
        const currentTotal = parseInt(match[1], 10);
        const today = new Date().toDateString();
        const display = document.getElementById(`c-${index}`);

        if (friend.date !== today) {
          friend.date = today;
          friend.initialCount = currentTotal;
          // Update stored object
          chrome.storage.local.get(['friends'], (res) => {
            res.friends[index] = friend;
            chrome.storage.local.set({ friends: res.friends });
          });
        }
        display.textContent = (currentTotal - friend.initialCount) + " solved";
      }
    } catch (e) {
      document.getElementById(`c-${index}`).textContent = "Err";
    }
  }

  addBtn.addEventListener('click', () => {
    const user = usernameInput.value.trim();
    if (!user) return;
    chrome.storage.local.get(['friends'], (result) => {
      let friends = result.friends || [];
      if (!friends.find(f => f.username === user)) {
        friends.push({ username: user, date: null, initialCount: null });
        chrome.storage.local.set({ friends }, updateUI);
        usernameInput.value = '';
      }
    });
  });

  clearBtn.addEventListener('click', () => {
    chrome.storage.local.set({ friends: [] }, updateUI);
  });

  updateUI();
});