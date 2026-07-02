import { Module } from '@nestjs/common';
import { CollectionsService } from './collections.service';
import { CollectionsController } from './collections.controller';
import { AuthzModule } from '../authz/authz.module';

@Module({
    imports: [AuthzModule],
    providers: [CollectionsService],
    controllers: [CollectionsController],
    exports: [CollectionsService],
})
export class CollectionsModule { }
