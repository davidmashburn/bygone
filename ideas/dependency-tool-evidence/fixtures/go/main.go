package main
import a "example.test/graphprobe/lib"
import b "example.test/graphprobe/other"
func init() { a.Target() }
func caller() {
    a.Target()
    b.Target()
    worker := a.Worker{}
    worker.Run()
    a.Register(a.Target)
}
func shadow(a func() int) int { return a() }
func main() { caller() }
