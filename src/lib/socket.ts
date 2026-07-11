import { io, type Socket } from 'socket.io-client';
import { getSocketUrl } from './api';

export const socket = io(getSocketUrl(), {
  autoConnect: false,
  transports: ['websocket', 'polling'],
  withCredentials: true,
}) as Socket & {
  on: (event: string, listener: (...args: any[]) => void) => typeof socket;
  off: (event: string, listener?: (...args: any[]) => void) => typeof socket;
};
