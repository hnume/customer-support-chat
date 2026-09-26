// Error ของ business layer — api แปลงเป็น HTTP status
export class AppError extends Error {
  constructor(public readonly code: 'VALIDATION' | 'NOT_FOUND' | 'UNAUTHORIZED', message: string) {
    super(message);
  }
}
export const validation = (msg: string) => new AppError('VALIDATION', msg);
export const notFound = (msg: string) => new AppError('NOT_FOUND', msg);
export const unauthorized = (msg: string) => new AppError('UNAUTHORIZED', msg);
