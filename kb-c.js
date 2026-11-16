document.querySelectorAll('button[data-v]').forEach(function (b) {
  b.addEventListener('click', function () {
    var v = b.dataset.v, root = document.documentElement;
    var box = document.createElement(v === '4' ? 'div' : 'dialog');
    if (v === '4') box.className = 'sheet';
    box.innerHTML = '<p>視窗 ' + v + '</p><input placeholder="金額" inputmode="decimal"><input placeholder="類別"><input placeholder="備註"><p><button type="button" class="x"' + (v === '2' || v === '3' ? ' autofocus' : '') + '>關閉</button></p>';
    document.body.appendChild(box);
    var y = window.scrollY;
    if (v === '1' || v === '2') { root.classList.add('pinned'); document.body.style.top = '-' + y + 'px'; }
    function done() { box.remove(); root.classList.remove('pinned'); document.body.style.top = ''; window.scrollTo(0, y); }
    box.querySelector('.x').addEventListener('click', function () { if (box.close) box.close(); else done(); });
    if (v !== '4') { box.addEventListener('close', done); box.showModal(); }
    if (v === '1') box.querySelector('input').focus();
  });
});
