import { Test, TestingModule } from '@nestjs/testing';
import { PenaltyCronService } from './penalty-cron.service';

describe('PenaltyCronService', () => {
  let service: PenaltyCronService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PenaltyCronService],
    }).compile();

    service = module.get<PenaltyCronService>(PenaltyCronService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
