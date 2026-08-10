import { UserRole } from '../../users/entities/user.entity';

export type JwtTokenType = 'access' | 'refresh';

export interface JwtPayload {
  sub: string;
  role: UserRole;
  type: JwtTokenType;
}

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
}
