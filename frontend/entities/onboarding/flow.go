// Package onboarding is the first-run flow's state: which step shows,
// derived from Telegram's sign-in state and what the user has done.
package onboarding

import tg "github.com/AstraFoundry/telo/backend/domain/telegram"

// Step is one screen of the flow.
type Step int

const (
	Welcome Step = iota
	Phone
	QR
	Code
	Password
	Register
	Agent
	Done
)

// Steps is the flow's order, for the stepper.
var Steps = []Step{Welcome, Phone, Code, Password, Agent, Done}

// Flow holds what the user did that Telegram does not record.
type Flow struct {
	// Started is set once Get started was pressed.
	Started bool
	// PreferQR shows the QR code instead of the phone form.
	PreferQR bool
	// AgentDone is set once the agent step was continued or skipped.
	AgentDone bool
	// Direction is the last move, -1 back or 1 forward, for the slide.
	Direction int
}

// Step returns the screen to show for the sign-in state.
func (f Flow) Step(auth tg.AuthState) Step {
	if !f.Started {
		return Welcome
	}
	switch auth.Step {
	case tg.AuthWaitQR:
		return QR
	case tg.AuthWaitCode:
		return Code
	case tg.AuthWaitPassword:
		return Password
	case tg.AuthWaitRegister:
		return Register
	case tg.AuthReady:
		if !f.AgentDone {
			return Agent
		}
		return Done
	}
	if f.PreferQR {
		return QR
	}
	return Phone
}

// Progress places a step on the stepper: its position and the count.
func Progress(s Step) (current, total int) {
	pos := map[Step]int{Welcome: 0, Phone: 1, QR: 1, Code: 2, Register: 2, Password: 3, Agent: 4, Done: 5}
	return pos[s], len(Steps) - 1
}
