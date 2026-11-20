/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface DeviceInfo {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  deviceType: 'mobile' | 'tablet' | 'desktop';
  os: 'Android' | 'iOS' | 'Windows' | 'macOS' | 'Linux' | 'Unknown';
  browser: string;
  hasTouch: boolean;
  isPortrait: boolean;
  screenSize: string;
  labelUk: string;
}

export function detectDevice(): DeviceInfo {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const hasTouch =
    typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0);

  // OS Detection
  let os: DeviceInfo['os'] = 'Unknown';
  if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Macintosh|Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  // Tablet Detection
  const isTablet =
    /(ipad|tablet|(android(?!.*mobile))|(windows(?!.*phone)(.*touch))|kindle|playbook|silk)/i.test(
      ua
    ) || (os === 'iOS' && hasTouch && Math.max(window.innerWidth, window.innerHeight) > 1024);

  // Mobile Detection
  const isMobile =
    !isTablet &&
    (/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino/i.test(
      ua
    ) ||
      (hasTouch && Math.min(window.innerWidth, window.innerHeight) < 768));

  const isDesktop = !isMobile && !isTablet;
  const deviceType: DeviceInfo['deviceType'] = isMobile
    ? 'mobile'
    : isTablet
    ? 'tablet'
    : 'desktop';

  // Browser Detection
  let browser = 'Браузер';
  if (/Chrome/i.test(ua) && !/Edge|OPR/i.test(ua)) browser = 'Chrome';
  else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';
  else if (/Firefox/i.test(ua)) browser = 'Firefox';
  else if (/Edg/i.test(ua)) browser = 'Edge';
  else if (/OPR|Opera/i.test(ua)) browser = 'Opera';

  const isPortrait =
    typeof window !== 'undefined' ? window.innerHeight > window.innerWidth : false;
  const screenSize =
    typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : '';

  let labelUk = 'ПК / Комп\'ютер';
  if (isMobile) {
    labelUk = `Смартфон (${os})`;
  } else if (isTablet) {
    labelUk = `Планшет (${os})`;
  } else {
    labelUk = `ПК / Ноутбук (${os})`;
  }

  return {
    isMobile,
    isTablet,
    isDesktop,
    deviceType,
    os,
    browser,
    hasTouch,
    isPortrait,
    screenSize,
    labelUk,
  };
}

export function tryRequestFullscreen(element: HTMLElement = document.documentElement): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      if (document.fullscreenElement) {
        resolve(true);
        return;
      }

      const el = element as unknown as {
        requestFullscreen?: () => Promise<void>;
        webkitRequestFullscreen?: () => Promise<void>;
        mozRequestFullScreen?: () => Promise<void>;
        msRequestFullscreen?: () => Promise<void>;
      };

      if (el.requestFullscreen) {
        el.requestFullscreen()
          .then(() => resolve(true))
          .catch(() => resolve(false));
      } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen()
          .then(() => resolve(true))
          .catch(() => resolve(false));
      } else if (el.mozRequestFullScreen) {
        el.mozRequestFullScreen()
          .then(() => resolve(true))
          .catch(() => resolve(false));
      } else if (el.msRequestFullscreen) {
        el.msRequestFullscreen()
          .then(() => resolve(true))
          .catch(() => resolve(false));
      } else {
        resolve(false);
      }
    } catch {
      resolve(false);
    }
  });
}

export function exitFullscreen(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      if (!document.fullscreenElement) {
        resolve(true);
        return;
      }
      document
        .exitFullscreen()
        .then(() => resolve(true))
        .catch(() => resolve(false));
    } catch {
      resolve(false);
    }
  });
}
