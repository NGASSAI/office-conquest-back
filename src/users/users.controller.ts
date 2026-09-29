import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UsersService } from './users.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/role.enum';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { SetSecretPhraseDto } from './dto/set-secret-phrase.dto';
import { SetAvatarDto } from './dto/set-avatar.dto';
import { SoloGameSyncDto } from './dto/solo-game-sync.dto';
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
    return this.usersService.changeTeam(user.userId, dto.teamId ?? null);
  }

    @Get('me/performance')
  getMyPerformance(@CurrentUser() user: { userId: string }) {
    return this.usersService.getPerformance(user.userId);
  }

   // Liste minimale des collègues actifs, pour choisir un adversaire de duel —
  // volontairement limitée (pas d'email, pas de statistiques) pour ne pas exposer de données inutiles
  @Get('directory')
  getDirectory(@CurrentUser() user: { userId: string }) {
    return this.usersService.getDirectory(user.userId);
  }

  @Get('leaderboard')
  getLeaderboard() {
    return this.usersService.getLeaderboard();
  }

  @Patch('me/secret-phrase')
  setSecretPhrase(@CurrentUser() user: { userId: string }, @Body() dto: SetSecretPhraseDto) {
    return this.usersService.setSecretPhrase(user.userId, dto.secretPhrase);
  }
    @Patch('me/avatar')
  setAvatar(@CurrentUser() user: { userId: string }, @Body() dto: SetAvatarDto) {
    return this.usersService.setAvatar(user.userId, dto.emoji, dto.color);
  }

  @Post('me/solo-game-sync')
  syncSoloGame(@CurrentUser() user: { userId: string }, @Body() dto: SoloGameSyncDto) {
    return this.usersService.syncSoloGame(user.userId, dto);
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
