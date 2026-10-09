import { defineGroup } from "../../registry/define"
import { list } from "./list"
import { assign, done, move, remove, review, start, unassign } from "./move"
import { history, link, open, search, unlink, url } from "./relations"
import { view } from "./view"
import { create, edit } from "./write"

export default defineGroup({
  name: "task",
  aliases: ["t"],
  summary: "List, create, edit and move tasks",
  description:
    "Work with tasks. TASK is a key like WEB-12 (any case), a number with -p, a task id or a\n" +
    "task link from the web app.",
  commands: [
    list,
    view,
    create,
    edit,
    move,
    start,
    review,
    done,
    assign,
    unassign,
    remove,
    history,
    link,
    unlink,
    search,
    open,
    url,
  ],
  examples: [
    "intesa task list --mine",
    'intesa task create -T "Fix login redirect" -a @me',
    "intesa task move WEB-12 review",
  ],
})
