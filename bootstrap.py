""" Run this script directly after cloning the project. """

import os
import os.path as op
import glob
import json
import platform
import sys
import subprocess
import shlex
import shutil

SLUG = 'gretel5'
WINDOWS = (platform.system() == 'Windows')
VIRTUALENV_BINDIR = 'Scripts' if WINDOWS else 'bin'
LOGFILE_NAME = 'bootstrap.log'


class Command(object):
    """ Representation of a command to be run in project setup.

        We create a bunch of these to implement most of the steps in main.
    """

    @classmethod
    def get_log(cls):
        if not hasattr(cls, 'log'):
            cls.log = open(LOGFILE_NAME, 'w', buffering=1)
        return cls.log

    def __init__(self, description, command, *args, **kwargs):
        self.description = description
        if isinstance(command, str):
            command = shlex.split(command)
        self.command = command
        self.args = args
        if 'stdout' not in kwargs:
            kwargs['stdout'] = self.get_log()
        if 'stderr' not in kwargs:
            kwargs['stderr'] = subprocess.STDOUT
        self.kwargs = kwargs

    def __call__(self):
        log = self.get_log()
        print('{}... '.format(self.description), end='', flush=True)
        log.write('$ {}\n\n'.format(self))
        try:
            exit_code = subprocess.call(self.command, *self.args, **self.kwargs)
            if exit_code != 0:
                print('failed ({}).'.format(exit_code))
                return False
            print('success.')
            log.write('\n\n')
            return True
        except Exception as e:
            print(e)
            log.write('never ran (exception)\n\n')
            return False

    def __str__(self):
        representation = ' '.join(map(shlex.quote, self.command))
        if 'cwd' in self.kwargs:
            return '(cd {} ; {})'.format(self.kwargs['cwd'], representation)
        return representation


def main(argv):
    already_in_project, cd_into_project = prepare_cwd()
    venv, create_virtualenv, activate_venv = prepare_virtualenv()
    pip_tools = backpack = funcpack = False
    if venv:
        pip_tools = install_pip_tools()
        backpack = install_backend_packages()
        funcpack = install_functest_packages()
    frontpack = install_frontend_packages()
    db, create_db = prepare_db()
    migrate = superuser = False
    if db and backpack:
        migrate = run_migrations()
        if migrate:
            superuser = create_superuser()
    main_branch = track_main()
    gitflow = False
    if main_branch:
        gitflow = setup_gitflow()
    if not all([gitflow, superuser, frontpack, funcpack, pip_tools]):
        print('\nPlease read {} for information on failed commands.'.format(LOGFILE_NAME))
    print('\nAlmost ready to go! Just a couple more commands to run:')
    if not already_in_project: print(cd_into_project)
    if not venv: print(create_virtualenv)
    print(activate_venv)
    if not (pip_tools and backpack and frontpack and funcpack): print(install_all_packages)
    if not db: print(create_db)
    if not migrate: print(run_migrations)
    if not superuser: print(create_superuser)
    if not main_branch: print(track_main)
    if not gitflow: print(setup_gitflow)
    print(yarn_start)


def prompt(variable, default_value):
    return input('{} [{}]: '.format(variable, default_value)) or default_value


def prepare_cwd():
    invocation_dir = op.abspath(os.getcwd())
    project_root = op.dirname(op.abspath(__file__))
    if invocation_dir == project_root:
        return True, None
    os.chdir(project_root)
    relative_path = op.relpath(project_root, invocation_dir)
    cd_into_project = Command('', ['cd', relative_path])
    return False, cd_into_project


def prepare_virtualenv():
    default_env = '.env'
    env_path = prompt('virtualenv', default_env)
    default_cmd = 'virtualenv {} --prompt="{}"'.format(env_path, SLUG)
    env_cmd = prompt('virtualenv_command', default_cmd)
    create_command = make_create_venv_command(env_cmd)
    activate_command = make_activate_venv_command(env_path)
    success = create_command()
    if success:
        adopt_virtualenv(env_path)
    return success, create_command, activate_command


def make_create_venv_command(venv_cmd):
    return Command('Create the virtualenv', venv_cmd)


def make_activate_venv_command(venv_path):
    activate_helper = ([] if WINDOWS else ['source'])
    return Command(
        '',
        activate_helper + [op.join(venv_path, VIRTUALENV_BINDIR, 'activate')],
    )


def adopt_virtualenv(env_path):
    """ Enable the virtualenv for our own subprocesses. """
    # first lines are a quick imitation of a local bin/activate script
    venv_abs = op.abspath(env_path)
    os.environ['VIRTUAL_ENV'] = venv_abs
    python_bindir = op.join(venv_abs, VIRTUALENV_BINDIR)
    os.environ['PATH'] = os.pathsep.join([python_bindir, os.environ['PATH']])
    os.environ.pop('PYTHONHOME', None)
    # next line is a fix for https://bugs.python.org/issue22490
    os.environ.pop('__PYVENV_LAUNCHER__', None)


def prepare_db():
    default_cmd = 'psql'
    psql_cmd = prompt('psql_command', default_cmd)
    create_command = make_create_db_command(psql_cmd)
    success = create_command()
    return success, create_command


def make_create_db_command(psql_cmd):
    # psql does not properly indicate failure; it always exits with 0.
    # Fortunately, it is one of the last commands.
    return Command(
        'Create the database',
        psql_cmd + ' -f ' + op.join('backend', 'create_db.sql'),
    )

def merge_json(target, source):
    for key, value in source.items():
        if value == None:
            del target[key]
        elif key in target and isinstance(target[key], dict) and \
            isinstance(source[key], dict):
            merge_json(target[key], source[key])
        else:
            target[key] = value
    return target

def modify_angular_json():
    with open('web-ui/angular.json', 'r') as file:
        data = json.load(file)
    try:
        project = 'gretel5'.replace('_', '-')
        for lang in 'en:english,nl:dutch'.split(','):
            [code, lang_name] = lang.split(':')
            production = merge_json({}, data['projects'][project]['architect']['build']['configurations']['production'])
            production['outputPath'] = f'dist/{code}'
            production['i18nFile'] = f'locale/messages.{code}.xlf'
            production['i18nFormat'] = 'xlf'
            production['i18nLocale'] = code
            production['i18nMissingTranslation'] = 'error'
            data['projects'][project]['architect']['build']['configurations'][f'production-{code}'] = production

            serve = merge_json({}, data['projects'][project]['architect']['serve']['configurations']['production'])
            serve['browserTarget'] += f'-{code}'
            data['projects'][project]['architect']['serve']['configurations'][code] = serve

        data['projects'][project]['architect']['build']['options']['outputPath'] = \
            data['projects'][project]['architect']['build']['configurations']['production']['outputPath'] = 'dist'

        # remove e2e
        del data['projects'][project]['architect']['e2e']
    except:
        print("Oh no! :( Maybe the format changed?")
        print(json.dumps(data, indent=4))
        raise
    with open('web-ui/angular.json', 'w') as file:
        json.dump(data, file, indent=4)

def activate_frontend():
    framework = 'angular'
    os.rename('package.angular.json', 'package.json')

    if framework == 'backbone':
        os.rename('frontend.backbone', 'frontend')
        shutil.move(op.join('frontend', 'proxy.json'), 'proxy.json')
        override_package_json()
    elif framework == 'angular':
        project_name = 'gretel5'.replace('_', '-')
        Command(
            'Install dependencies',
            ['yarn', 'install', '--ignore-scripts']
        )()
        Command(
            'Creating project',
            ['yarn', 'ng', 'new', project_name, '--prefix=dh',
                '--skip-git=true',
                '--skip-install=true',
                '--package-manager=yarn',
                '--style=scss',
                '--routing=true']
        )()
        shutil.copytree('frontend.angular', project_name, dirs_exist_ok=True)
        os.rename(project_name, 'frontend')
        shutil.move(op.join('frontend', 'proxy.conf.json'), 'proxy.conf.json')
        override_package_json()
        Command(
            'Install frontend dependencies using Yarn',
            ['yarn'],
            cwd="frontend"
        )()
        # Remove e2e
        shutil.rmtree(os.path.join('frontend', 'e2e'))
        # Remove editorconfig
        os.remove(os.path.join('frontend', '.editorconfig'))
        modify_angular_json()
        Command(
            'Creating localizations',
            ['yarn', 'ng', 'add', '@angular/localize'],
            cwd="frontend"
        )()
        Command(
            'Creating localizations',
            ['yarn', 'i18n'],
            cwd="frontend"
        )()
        for lang in 'en:english,nl:dutch'.split(','):
            [code, lang_name] = lang.split(':')
            shutil.copyfile('web-ui/locale/messages.xlf', f'web-ui/locale/messages.{code}.xlf')
        if '4200' != '4200':
            Command(
                'Set frontend port',
                ['yarn', 'ng', 'config', "projects.gretel5.architect.serve.options.port", '4200'],
                cwd="frontend"
            )()
    else:
        print('Unknown framework angular specified!')
    # remove other frameworks
    for path in glob.glob("frontend.*"):
        shutil.rmtree(path)
    for path in glob.glob("package.*.json"):
        os.remove(path)

def override_package_json():
    if os.path.isfile('web-ui/package.overwrite.json'):
        print('Overriding package.json')
        with open('web-ui/package.overwrite.json', 'r') as file:
            overwrite = json.load(file)
        with open('web-ui/package.json', 'r') as file:
            data = json.load(file)
        with open('web-ui/package.json', 'w') as file:
            merge_json(data, overwrite)
            json.dump(data, file, indent=4)
        os.remove('web-ui/package.overwrite.json')

install_pip_tools = Command(
    'Install pip-tools',
    ['yarn', 'preinstall'],
)

install_backend_packages = Command(
    'Install the backend requirements',
    ['yarn', 'install-back'],
)

install_functest_packages = Command(
    'Install the functional test requirements',
    ['yarn', 'install-func'],
)

install_frontend_packages = Command(
    'Install the frontend packages',
    ['yarn', 'fyarn'],
)

install_all_packages = Command('Install all packages', ['yarn'])

run_migrations = Command(
    'Run the initial migrations',
    ['yarn', 'django', 'migrate'],
)

# Github Actions sets "CI" environment variable
if os.environ.get('CI'):
    create_superuser = Command(
        'Skip creating the superuser',
        ['yarn', 'back', ':'], # ':' for no-op
        stdout=None, # share stdout and stderr with this process
        stderr=None,
    )
else:
    create_superuser = Command(
        'Create the superuser',
        ['yarn', 'django', 'createsuperuser'],
        stdout=None, # share stdout and stderr with this process
        stderr=None,
    )

track_main = Command(
    'Create origin-tracking main branch',
    ['git', 'branch', '--track', 'main', 'origin/main'],
)

setup_gitflow = Command(
    'Initialize git-flow',
    ['git', 'flow', 'init', '-d'],
)

yarn_start = Command('', ['yarn', 'start'])


if __name__ == '__main__':
    sys.exit(main(sys.argv))
