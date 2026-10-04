import { SetMetadata } from '@nestjs/common';
import type { UserRole } from './auth.types';

export const IS_PUBLIC = 'payflow:is-public';
export const ALLOWED_ROLES = 'payflow:allowed-roles';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const Roles = (...roles: UserRole[]) => SetMetadata(ALLOWED_ROLES, roles);
