import { Test, TestingModule } from '@nestjs/testing';
import { DocumentVaultController } from './document-vault.controller';

describe('DocumentVaultController', () => {
  let controller: DocumentVaultController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DocumentVaultController],
    })
      .useMocker(() => ({}))
      .compile();

    controller = module.get<DocumentVaultController>(DocumentVaultController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
