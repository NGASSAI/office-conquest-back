import { Controller, Get, Query } from '@nestjs/common';
import { AdminService } from './admin.service';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/role.enum';
// Protection au niveau du contrôleur entier : chaque route exige le rôle ADMIN
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  getGlobalStats() {
    return this.adminService.getGlobalStats();
  }

  @Get('activity')
  getActivity(@Query('limit') limit?: string) {
    return this.adminService.getRecentActivity(limit ? parseInt(limit, 10) : 50);
  }

  @Get('raids')
  getRaidsOverview() {
    return this.adminService.getRaidsOverview();
  }
}
