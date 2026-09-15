import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { UsersService } from './users.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/role.enum';
import { UpdateTeamDto } from './dto/update-team.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Profil de l'utilisateur connecté
  @Get('me')
  getMe(@CurrentUser() user: { userId: string }) {
    return this.usersService.getProfile(user.userId);
  }

  // Changement d'équipe libre (décidé par l'utilisateur)
  @Patch('me/team')
  changeTeam(@CurrentUser() user: { userId: string }, @Body() dto: UpdateTeamDto) {
    return this.usersService.changeTeam(user.userId, dto.teamId);
  }

  @Get('me/performance')
  getMyPerformance(@CurrentUser() user: { userId: string }) {
    return this.usersService.getPerformance(user.userId);
  }

  // --- Routes admin ---

  @Roles(UserRole.ADMIN)
  @Get()
  listUsers(@Query() query: ListUsersQueryDto) {
    return this.usersService.listUsers(query);
  }

  @Roles(UserRole.ADMIN)
  @Get(':id/performance')
  getUserPerformance(@Param('id') id: string) {
    return this.usersService.getPerformance(id);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/block')
  blockUser(@Param('id') id: string, @CurrentUser() admin: { userId: string }) {
    return this.usersService.setStatus(id, 'BLOCKED', admin.userId);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/unblock')
  unblockUser(@Param('id') id: string, @CurrentUser() admin: { userId: string }) {
    return this.usersService.setStatus(id, 'ACTIVE', admin.userId);
  }
}
