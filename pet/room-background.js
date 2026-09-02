(function() {
  'use strict';

  /**
   * 現在の時刻から時間帯を返す
   * @returns {string} 'morning' | 'day' | 'evening' | 'night'
   */
  function getTimeOfDay() {
    const hour = new Date().getHours();

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

  /**
   .pet-stage に data-timeofday 属性を設定する
   */
  function updateTimeOfDay() {
    const petStage = document.querySelector('.pet-stage');
    if (petStage) {
      petStage.setAttribute('data-timeofday', getTimeOfDay());
    }
  }

  // 初回実行（DOM読み込み後）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateTimeOfDay);
  } else {
    updateTimeOfDay();
  }

  // 1分ごとに更新
  setInterval(updateTimeOfDay, 60000);

})();
