import { Command } from "../Command.ts";

export class GreetCommand extends Command {
  static commandName = "greet:fixture";
  static description = "Greet from a discovered fixture";
  async run(): Promise<void> {
    this.info("discovered");
  }
}

export const NOT_A_COMMAND = 42;
