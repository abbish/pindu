/**
 * 跳到某个位置，跳好了再返回：跳转没完成就 play()，WebKit 会先放出旧位置的一点声音再跳，句首听起来卡一下。
 * 已经在这个位置（差不到 10ms）时直接返回；等不到 seeked（元素还没加载等）最多等 `timeoutMs`。
 */
export function seekMedia(el: HTMLMediaElement, seconds: number, timeoutMs = 1500): Promise<void> {
  if (Math.abs(el.currentTime - seconds) < 0.01 && !el.seeking) return Promise.resolve();
  return new Promise((resolve) => {
    let timer = 0;
    const done = () => {
      window.clearTimeout(timer);
      el.removeEventListener('seeked', done);
      resolve();
    };
    el.addEventListener('seeked', done);
    timer = window.setTimeout(done, timeoutMs);
    el.currentTime = seconds;
  });
}
