(() => {
  'use strict';
  const T = window.PokoFuwaTransfer, $ = id => document.getElementById(id);
  $('old-save-link').hidden = window.location.hostname !== 'pokofuwa.jr-genius.jp';
  let current = null, incoming = null, savedFingerprint = null, busy = false, blocked = false;
  function describe(data) { const s = T.summary(data); return `${s.hasState ? `名前：${s.petName}\n育てた記録・設定・覚えた言葉` : '育てた記録なし'}\n覚えた声 ${s.voices}件 ／ 写真 ${s.photos}枚 ／ 録音 ${s.radio}本`; }
  function status(message, error = false) { $('transfer-status').textContent = message; $('transfer-status').dataset.error = String(error); }
  async function controls() {
    $('transfer-status').dataset.busy = String(busy);
    $('save-transfer').disabled = busy || blocked || !current || !T.hasData(current);
    $('transfer-file').disabled = busy || blocked;
    $('restore-confirm').disabled = busy || blocked;
    $('restore-transfer').disabled = busy || blocked || !incoming || !$('restore-confirm').checked || (current && T.hasData(current) && savedFingerprint !== await T.fingerprint(current));
    $('retry-recovery').hidden = !blocked;
    $('back-link').hidden = busy || blocked;
  }
  const messages = {
    'close-other-tabs':'ほかのタブを閉じてから、もう一度ためしてください。',
    'newer-version':'新しい版で作られたファイルです。このページを更新してからためしてください。',
    'damaged-file':'ファイルが途中で変わっているか、壊れています。元の端末で保存し直してください。',
    'too-large':'ファイルが大きすぎます。64MB以内の引き継ぎファイルを選んでください。',
    'invalid-file':'このファイルは読み込めません。ぽこ・ふわで保存した引き継ぎファイルを選んでください。',
    'data-changed':'別のタブで記録が変わりました。ほかのタブを閉じ、このページを開き直してください。',
    'recovery-required':'引き継ぎが中断しました。元の記録への復旧が必要です。',
    'recovery-missing':'復旧用の記録を読めません。保存した引き継ぎファイルを消さずに保管してください。'
  };
  function failure(error) { status(messages[error.message] || '保存場所を使えませんでした。空き容量とブラウザの保存設定を確認して、もう一度ためしてください。', true); }
  async function run(action) {
    if (busy) return;
    busy = true; await controls();
    try { await T.exclusive(action); }
    catch (error) { failure(error); }
    finally { busy = false; try { blocked = !!localStorage.getItem(T.PENDING); } catch (_) { blocked = true; } await controls(); }
  }
  function download(text) {
    const url = URL.createObjectURL(new Blob([text], {type:'application/json'}));
    const link = document.createElement('a'); link.href = url;
    link.download = `pokofuwa-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function refresh() { current = await T.snapshot(); $('current-summary').textContent = describe(current); }
  async function start() {
    await run(async () => {
      status('記録を確認しています…');
      const recovered = await T.recover();
      blocked = false; await refresh();
      status(recovered ? '中断前の記録へ戻しました。もう一度引き継げます。' : '準備できました。元の端末で保存し、新しい場所で読み込んでください。');
    });
  }
  $('save-transfer').addEventListener('click', () => run(async () => {
    status('引き継ぎファイルを作っています…');
    await refresh();
    const text = await T.makeFile(current);
    download(text); savedFingerprint = await T.fingerprint(current);
    status('保存を開始しました。端末のダウンロード先にファイルがあることを確認してください。元の記録は残っています。');
  }));
  $('transfer-file').addEventListener('change', () => run(async () => {
    incoming = null; $('import-preview').hidden = true; $('restore-confirm').checked = false; $('play-after-transfer').hidden = true;
    const file = $('transfer-file').files[0]; if (!file) return;
    if (file.size > T.MAX_FILE) throw new Error('too-large');
    status('引き継ぎファイルを確認しています…');
    const parsed = await T.parseFile(await file.text());
    if (!T.hasData(parsed.data)) throw new Error('invalid-file');
    incoming = parsed.data; await refresh();
    $('incoming-summary').textContent = `保存日時：${new Date(parsed.createdAt).toLocaleString('ja-JP')}\n${describe(incoming)}`;
    $('replace-note').hidden = !T.hasData(current);
    const audio = document.createElement('audio');
    $('audio-compatibility').hidden = ![...incoming.databases[0].clips, ...incoming.databases[2].clip].some(row => !audio.canPlayType(row.mimeType));
    $('import-preview').hidden = false; status('ファイルを確認しました。内容を確認してから読み込んでください。');
  }));
  $('restore-confirm').addEventListener('change', controls);
  $('restore-transfer').addEventListener('click', () => run(async () => {
    if (!incoming || !$('restore-confirm').checked) return;
    if (T.hasData(current) && savedFingerprint !== await T.fingerprint(current)) throw new Error('data-changed');
    status('思い出を読み込んでいます。この画面を閉じずにお待ちください…');
    await T.restore(incoming, {expectedFingerprint:await T.fingerprint(current)});
    await refresh(); incoming = null; savedFingerprint = null;
    $('import-preview').hidden = true; $('transfer-file').value = '';
    $('play-after-transfer').hidden = false;
    status('引き継ぎができました。元の端末の記録も残っています。');
  }));
  $('retry-recovery').addEventListener('click', start);
  window.addEventListener('beforeunload', event => { if (busy) { event.preventDefault(); event.returnValue = ''; } });
  start();
})();
