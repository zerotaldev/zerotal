import { Factory } from "zerotal/testing";
import { PROJECT_STATUSES, Project } from "../../app/models/Project.ts";

/**
 * A project with a made-up name, description and status. Give it an owner:
 *
 *   await ProjectFactory.for(user).create();
 *   await ProjectFactory.for(user).count(3).create();
 */
export const ProjectFactory = Factory.define(Project, (fake) => ({
  name: fake.title(),
  description: fake.sentence(),
  status: PROJECT_STATUSES[fake.number(0, PROJECT_STATUSES.length - 1)]!,
}));
