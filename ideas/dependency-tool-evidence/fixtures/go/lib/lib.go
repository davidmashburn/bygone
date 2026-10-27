package lib
func Target() int { return 1 }
type Worker struct{}
func (w Worker) Run() int { return Target() }
func Register(cb func() int) func() int { return cb }
