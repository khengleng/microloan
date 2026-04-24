import { Module } from '@nestjs/common';
import { DocumentVaultService } from './document-vault.service';
import { DocumentVaultController } from './document-vault.controller';
import { AuthzModule } from '../authz/authz.module';

@Module({
  imports: [AuthzModule],
  providers: [DocumentVaultService],
  controllers: [DocumentVaultController]
})
export class DocumentVaultModule {}
