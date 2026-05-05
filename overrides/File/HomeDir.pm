package File::HomeDir;

# Minimal stub for WebPerl: latexindent only calls File::HomeDir->my_home
# to locate user config. Under WebPerl there is no real home directory,
# so we return a path that won't match any -f checks.

use strict;
use warnings;

sub my_home { return '/home'; }

1;
