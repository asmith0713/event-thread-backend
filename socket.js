let ioInstance = null;

export function setSocketIO(io) {
  ioInstance = io;
}

export function getSocketIO() {
  return ioInstance;
}

