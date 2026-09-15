import { SetMetadata } from '@nestjs/common';

type UserRole = string;

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);