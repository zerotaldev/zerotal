import { Migration } from '../Migration.ts';
import { Schema } from '../Schema.ts';

export default class CreateTestTable extends Migration {
  async up(): Promise<void> {
    await Schema.create('test_from_dir', (table) => {
      table.increments('id');
      table.string('label');
    });
  }

  async down(): Promise<void> {
    await Schema.dropIfExists('test_from_dir');
  }
}
