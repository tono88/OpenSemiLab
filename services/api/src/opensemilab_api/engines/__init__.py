from opensemilab_api.engines.devsim_adapter import DevsimEngine
from opensemilab_api.engines.educational import EducationalPNEngine

ENGINES = {
    "educational": EducationalPNEngine(),
    "devsim": DevsimEngine(),
}
