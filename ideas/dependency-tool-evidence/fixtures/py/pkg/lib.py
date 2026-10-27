def target():
    return 1
class Worker:
    def run(self):
        return target()
def register(cb):
    return cb
