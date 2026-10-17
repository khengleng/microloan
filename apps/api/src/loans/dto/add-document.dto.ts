import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * A document attached inline. Only a base64 data URI is accepted: a stored
 * value is later handed to the document store, so accepting a free string
 * here would let a caller point a document at another tenant's object.
 */
export class AddDocumentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @IsString()
  @Matches(/^data:[\w.+/-]+;base64,[A-Za-z0-9+/=]+$/, {
    message: 'content must be a base64 data URI (data:<type>;base64,<data>).',
  })
  @MaxLength(7 * 1024 * 1024)
  content: string;

  @IsString()
  @MaxLength(100)
  type: string;
}
