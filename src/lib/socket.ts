import { io, type Socket } from 'socket.io-client';
import { getSocketUrl } from './api';

export const socket = io(getSocketUrl(), {
  autoConnect: false,
  // Establish a reliable HTTP polling connection first, then upgrade to
  // WebSocket when proxies or mobile networks permit it. A failed initial
  // WebSocket upgrade must not block lobby admission notifications.
  transports: ['polling', 'websocket'],
  withCredentials: true,
}) as Socket & {
  on: (event: string, listener: (...args: any[]) => void) => typeof socket;
  off: (event: string, listener?: (...args: any[]) => void) => typeof socket;
};
