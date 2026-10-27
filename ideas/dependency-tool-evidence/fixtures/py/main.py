from pkg.lib import target as alias, Worker, register
from pkg.other import target as other
alias()
def caller():
    alias()
    other()
    worker = Worker()
    worker.run()
    register(alias)
def shadow(alias):
    return alias()
def lazy():
    from pkg.lib import target
    return target()
