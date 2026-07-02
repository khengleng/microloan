import { Module } from '@nestjs/common';
import { FxService } from './fx.service';
import { FxController } from './fx.controller';
import { AuthzModule } from '../authz/authz.module';

@Module({
    imports: [AuthzModule],
    providers: [FxService],
    controllers: [FxController],
    exports: [FxService],
})
export class FxModule { }
