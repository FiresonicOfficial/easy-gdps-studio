import type { EasyGdpsBridge } from '@shared/types';

declare global {
  interface Window {
    easyGdps: EasyGdpsBridge;
  }
}

export {};
