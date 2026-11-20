(function() {
  'use strict';

  /**
   * 現在の時刻から時間帯を返す
   * @returns {string} 'morning' | 'day' | 'evening' | 'night'
   */
  function getTimeOfDay(hour) {

    if (hour >= 5 && hour < 10) {
      return 'morning';
    }
    if (hour >= 10 && hour < 16) {
      return 'day';
    }
    if (hour >= 16 && hour < 19) {
      return 'evening';
    }
    return 'night';
  }

  let minuteTimer;
  function updateRoomTime() {
    clearTimeout(minuteTimer);
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const petStage = document.querySelector('.pet-stage');
    if (petStage) petStage.setAttribute('data-timeofday', getTimeOfDay(hour));

    document.getElementById('room-clock-hour').setAttribute('transform', `rotate(${(hour % 12) * 30 + minute / 2} 30 30)`);
    document.getElementById('room-clock-minute').setAttribute('transform', `rotate(${minute * 6} 30 30)`);
    minuteTimer = setTimeout(updateRoomTime, 60000 - now.getSeconds() * 1000 - now.getMilliseconds());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateRoomTime);
  } else {
    updateRoomTime();
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) updateRoomTime();
  });
})();
