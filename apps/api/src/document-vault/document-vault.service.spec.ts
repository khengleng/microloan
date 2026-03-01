import { Test, TestingModule } from '@nestjs/testing';
import { DocumentVaultService } from './document-vault.service';

describe('DocumentVaultService', () => {
  let service: DocumentVaultService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DocumentVaultService],
    }).compile();

    service = module.get<DocumentVaultService>(DocumentVaultService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
