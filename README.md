# GrETEL5

[![Actions Status](https://github.com/UUDigitalHumanitieslab/gretel-django/workflows/Tests/badge.svg)](https://github.com/UUDigitalHumanitieslab/gretel-django/actions)
[![DOI](https://zenodo.org/badge/95562504.svg)](https://zenodo.org/badge/latestdoi/95562504)

## Before you start

You need to install the following software:

- PostgreSQL >= 10, client, server and C libraries
- Python >= 3.8, <= 3.10
- virtualenv
- WSGI-compatible webserver (deployment only)
- [Visual C++ for Python][1] (Windows only)
- Node.js >= 14.21.2
- [Yarn](https://yarnpkg.com/)
- [WebDriver][2] for at least one browser (only for functional testing)
- [BaseX](https://packages.debian.org/jessie/database/basex)
- [Alpino](https://www.let.rug.nl/vannoord/alp/Alpino/) dependency parser. It is recommended to use the same version used for creating the treebanks. This way an example based search will result in the same search structure as stored in the database.
- [Redis](https://redis.io/)
[1]: https://wiki.python.org/moin/WindowsCompilers
[2]: https://pypi.org/project/selenium/#drivers

## How it works

This project integrates three isolated subprojects, each inside its own subdirectory with its own code, package dependencies and tests:

- **backend**: the server side web application based on [Django][3] and [DRF][4]
- **frontend**: the client side web application based on [Angular](https://angular.io)
- **functional-tests**: the functional test suite based on [Selenium][6] and [pytest][7]

[3]: https://www.djangoproject.com
[4]: https://www.django-rest-framework.org
[6]: https://www.selenium.dev/documentation/webdriver/
[7]: https://docs.pytest.org/en/latest/

Each subproject is configurable from the outside. Integration is achieved using "magic configuration" which is contained inside the root directory together with this README. In this way, the subprojects can stay truly isolated from each other.

If you are reading this README, you'll likely be working with the integrated project as a whole rather than with one of the subprojects in isolation. In this case, this README should be your primary source of information on how to develop or deploy the project. However, we recommend that you also read the "How it works" section in the README of each subproject.

## Development

### Quickstart

First time after cloning this project:

```console
python bootstrap.py
```

Check or adjust the `backend/gretel/settings.py` to make sure it points to the correct location of the BaseX and Alpino server.

Alpino can be started in server mode using:

```console
./alpino.sh
```

BaseX server can be started using:

```console
basexserver -s
```

Celery (used for running tasks in the background) can be started using:

```console
# sudo service redis start
cd backend
python -m celery -A gretel.celery worker --loglevel=info -B
```

Running the application in [development mode][8] (hit ctrl-C to stop):

```console
nvm use
source .env/bin/activate
yarn start
```

This will run the backend and frontend applications, as well as their unittests, and watch all source files for changes. You can visit the frontend on <http://localhost:8000/>, the browsable backend API on <http://localhost:8000/api/> and the backend admin on <http://localhost:8000/admin/>. On every change, unittests rerun, frontend code rebuilds and open browser tabs refresh automatically (livereload).

[8]: #development-mode-vs-production-mode

### Recommended order of development

For each new feature, we suggested that you work through the steps listed below. This could be called a back-to-front or "bottom up" order. Of course, you may have reasons to choose otherwise. For example, if very precise specifications are provided, you could move step 8 to the front for a more test-driven approach.

Steps 1–5 also include updating the unittests. Only functions should be tested, especially critical and nontrivial ones.

 1. Backend model changes including migrations.
 2. Backend serializer changes and backend admin changes.
 3. Backend API endpoint changes.
 4. Frontend model changes.
 5. Other frontend unit changes (templates, views, routers, FSMs).
 6. Frontend integration (globals, event bindings).
 7. Run functional tests, repair broken functionality and broken tests.
 8. [Add functional tests][9] for the new feature.
 9. Update technical documentation.

[9]: functional-tests/README.md#writing-tests

For release branches, we suggest the following checklist.

 1. Bump the version number in the `package.json` next to this README.
 2. Run the functional tests in production mode, fix bugs if necessary.
 3. Try using the application in production mode, look for problems that may have escaped the tests.
 4. Add regression tests (unit or functional) that detect problems from step 3.
 5. Work on the code until new regression tests from step 4 pass.
 6. Optionally, repeat steps 2–5 with the application running in a real deployment setup (see [Deployment](#deployment)).

### Commands for common tasks

The `package.json` next to this README defines several shortcut commands to help streamline development. In total, there are over 30 commands. Most may be regarded as implementation details of other commands, although each command could be used directly. Below, we discuss the commands that are most likely to be useful to you. For full details, consult the `package.json`.

Install the pinned versions of all package dependencies in all subprojects:

```console
yarn
```

Run backend and frontend in [production mode][8]:

```console
yarn start-p
```

Run the functional test suite:

```console
yarn test-func [FUNCTIONAL TEST OPTIONS]
```

The functional test suite by default assumes that you have the application running locally in production mode (i.e., on port `4200`). See [Configuring the browsers][10] and [Configuring the base address][11] in `functional-tests/README` for options.

[10]: functional-tests/README.md#configuring-the-browsers
[11]: functional-tests/README.md#configuring-the-base-address

Run *all* tests (mostly useful for continuous integration):

```console
yarn test [FUNCTIONAL TEST OPTIONS]
```

Run an arbitrary command from within the root of a subproject:

```console
yarn back  [ARBITRARY BACKEND COMMAND HERE]
yarn front [ARBITRARY FRONTEND COMMAND HERE]
yarn func  [ARBITRARY FUNCTIONAL TESTS COMMAND HERE]
```

For example,

```console
yarn back less README.md
```

is equivalent to

```console
cd backend
less README.md
cd ..
```

Run `python manage.py` within the `backend` directory:

```console
yarn django [SUBCOMMAND] [OPTIONS]
```

`yarn django` is a shorthand for `yarn back python manage.py`. This command is useful for managing database migrations, among other things.

Manage the frontend package dependencies:

```console
yarn fyarn (add|remove|upgrade|...) (PACKAGE ...) [OPTIONS]
```

### Notes on Python package dependencies

Both the backend and the functional test suite are Python-based and package versions are pinned using [pip-tools][13] in both subprojects. For ease of development, you most likely want to use the same virtualenv for both and this is also what the `bootstrap.py` assumes.

[13]: https://pypi.org/project/pip-tools/

This comes with a small catch: the subprojects each have their own separate `requirements.txt`. If you run `pip-sync` in one subproject, the dependencies of the other will be uninstalled. In order to avoid this, you run `pip install -r requirements.txt` instead. The `yarn` command does this correctly by default.

Another thing to be aware of, is that `pip-compile` takes the old contents of your `requirements.txt` into account when building the new version based on your `requirements.in`. You can use the following trick to keep the requirements in both projects aligned so the versions of common packages don't conflict:

```console
$ yarn back pip-compile
# append contents of backend/requirements.txt to functional-tests/requirements.txt
$ yarn func pip-compile
```

### Development mode vs production mode

The purpose of development mode is to facilitate live development, as the name implies. The purpose of production mode is to simulate deployment conditions as closely as possible, in order to check whether everything still works under such conditions. A complete overview of the differences is given below.

dimension  |  Development mode  |  Production mode
-----------|--------------------|-----------------
command  |  `yarn start`  |  `yarn start-p`
base address  |  <http://localhost:8000>  |  <http://localhost:4200>
backend server (Django)  |  in charge of everything  |  serves backend only
frontend server (angular-cli)  |  serves  |  watch and build
static files  |  served directly by Django's staticfiles app  |  collected by Django, served by gulp-connect
backend `DEBUG` setting  |  `True`  |  `False`
backend `ALLOWED_HOSTS`  |  -  |  restricted to `localhost`
frontend sourcemaps  |  yes  |  no
frontend optimization  |  no  |  yes

## Deployment

Both the backend and frontend applications have a section dedicated to deployment in their own READMEs. You should read these sections entirely before proceeding. All instructions in these sections still apply, though it is good to know that you can use the following shorthand commands from the integrated project root:

```console

# collect static files of both backend and frontend, with overridden settings
$ yarn django collectstatic --settings SETTINGS --pythonpath path/to/SETTINGS.py
```

You should build the frontend before collecting all static files.

## Notes for users

Only the properties of the first node matched by an XPATH variable is returned for analysis. For example:

A user searches for `//node[node]`. Two variables are found in this query: `$node1 = //node` and `$node2 = $node1[node]`.

The following sentence would match this query:

`node[np] (node[det] node[noun])`

The node found for `$node1` will then be `node[np]`.
The node found for `$node2` will then be `node[det]`. The properties of `node[noun]` will not be available for analysis using this query.

When searching for a more specific structure, this is unlikely to occur.

## Info

- v4.2.0 August 2019: federated search, improved configuration and state management, download results with node properties and again [many more fixes](https://github.com/UUDigitalHumanitieslab/gretel/compare/v4.1.0...v4.2.0).
- v4.1.0 February 2019: Fixed support for GrInded corpora, [many more fixes](https://github.com/UUDigitalHumanitieslab/gretel/compare/v4.0.2...v4.1.0), feature complete replacement of version 3.
- v4.0.2 October 2018: GrETEL 4 release with many bugfixes and improvements.
- v4.0.0 June 2018: First GrETEL 4 release with new interface.
- v3.9.99 November 2017: GrETEL 4 currently under development!
- v3.0.2 July 2017: Show error message if the BaseX server is down  
- v3.0. November 2016: GrETEL 3 initial release. Available at <http://gretel.ccl.kuleuven.be/gretel3>

### Branches

- `master`: official version of GrETEL 5, available at <https://gretel5.hum.uu.nl/gretel/>
- `develop`: development version  
- `gretel2.0`: official version of GrETEL 2.0, available at <https://gretel.ccl.kuleuven.be/gretel-2.0>

## Credits

- [Liesbeth Augustinus](https://www.ccl.kuleuven.be/~liesbeth/) and [Vincent Vandeghinste](https://www.ccl.kuleuven.be/~vincent/ccl): concept and initial implementation;
- [Bram Vanroy](https://bramvanroy.be/): GrETEL 3 improvements and design;
- [Martijn van der Klis](http://www.uu.nl/staff/MHvanderKlis): initial GrETEL 4 functionality and improvements;
- [Sheean Spoel](https://www.uu.nl/staff/SJJSpoel), [Gerson Foks](https://www.linkedin.com/in/gerson-foks-50b784b2) and [Jelte van Boheemen](https://www.uu.nl/medewerkers/JvanBoheemen): additional GrETEL 4 functionality and improvements;
- [Ben Bonfil](https://www.uu.nl/staff/BBonfil) and [Tijmen Baarda](https://www.uu.nl/staff/TCBaarda): additional GrETEL 5 functionality and improvements;
- [Jan Odijk](https://www.clariah.nl/nl/personen/jan-odijk) project lead for GrETEL 4 and GrETEL 5 developments;
- [Koen Mertens](https://github.com/KCMertens): federated search at [Instituut voor de Nederlandse taal](https://ivdnt.org).
- Colleagues at the [Centre for Computational Linguistics at KU Leuven](http://www.arts.kuleuven.be/ling/ccl), and [Utrecht University Digital Humanities Lab](https://dig.hum.uu.nl) for their feedback.

## License

This work is licensed under the Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License (cc-by-sa-4.0). See the [LICENSE](LICENSE) file for license rights and limitations.
