import { SetMetadata } from '@nestjs/common';

// Marque une route comme accessible sans authentification (ex: register, login, refresh)
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
